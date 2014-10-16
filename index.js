/* jshint node: true */
'use strict';

var mod_async = require('async');
var mod_obpath = require('obpath.js');

var _ = require('lodash');

function Bhulk(hapi, config) {
  this.hapi = hapi;
  this.config = config;
  this.obpathContext = mod_obpath.createContext();
  this.queryCache = {};
}

Bhulk.prototype.bulkRequest = function (bulkRequest, reply) {
  var bulkResult = {
    meta: {}
  };
  var hapi = this.hapi;
  var requests = {};
  var remoteHandler = this.config.remote;
  var iterationLimit = this.config.iterationLimit || 10;

  for (var key in bulkRequest.query) {
    if (key.substr(0,1) === '_') { continue; }

    var segments = key.split('.');
    var value = bulkRequest.query[key];
    var request = requests[segments[0]] = requests[segments[0]] || {};

    if (segments.length === 1) {
      request.url = value;
    }
    else if (segments.length === 2) {
      if (segments[1] === 'source') {
        request.source = value;
      }
      else if (segments[1] === 'each') {
        if (value === 'true') {
          request.each = true;
        }
      }
      else if (segments[1] === 'suppress') {
        if (value === 'true') {
          request.suppress = true;
        }
      }
      else if (segments[1] === 'query') {
        if (!this.queryCache[value]) {
          try {
            this.queryCache[value] = mod_obpath.mustCompile(value, this.obpathContext);
          } catch (syntaxError) {
            reply(hapi.error.badRequest('Bad path expression in "' + key + '": ' + syntaxError.message));
            return;
          }
        }
        request.query = this.queryCache[value];
      }
      else if (segments[1] === 'remote') {
        request.remote = value;
      }
    }
  }

  var treeError = this.validateTree(requests);
  if (treeError) {
    reply(hapi.error.badRequest(treeError.message));
    return;
  }

  var tasks = {};

  var urlReplacement = /\$\{([^}])\}/;
  function replace(placeholder, params) {
    var value = '';
    if (placeholder === ',') {
      value = _.uniq(params).join(placeholder);
    }
    if (placeholder === '.') {
      value = params.toString();
    }
    return encodeURIComponent(value.toString());
  }

  function requestWorker(requestSpec, callback, sources) {
    var data, params;

    if (!requestSpec.each) {
      var url = requestSpec.url;
      if (requestSpec.source && requestSpec.query) {
        data = sources[requestSpec.source];
        params = requestSpec.query.evaluate(data);

        url = requestSpec.url.replace(urlReplacement, function(match, placeholder) {
          return replace(placeholder, params);
        });
        if (url !== requestSpec.url) {
          requestSpec.realUrl = url;
        }
      }

      performRequest(requestSpec, url, callback);
    }
    else {
      if (requestSpec.source && requestSpec.query) {
        data = sources[requestSpec.source];
        params = requestSpec.query.evaluate(data);
        requestSpec.realUrls = [];

        if (params.length === 0) {
          return callback(null, {});
        }
        // We limit the number of request iterations we allow.
        else if (params.length > iterationLimit) {
          requestSpec.skippedUrls = params.slice(iterationLimit).map(function mapUrl(item) {
            return requestSpec.url.replace(urlReplacement, function(match, placeholder) {
              return replace(placeholder, item);
            });
          });
          params = params.slice(0, iterationLimit);
        }

        var queue = mod_async.queue(function eachJob(item, callback) {
          var url = requestSpec.url.replace(urlReplacement, function(match, placeholder) {
            return replace(placeholder, item);
          });
          requestSpec.realUrls.push(url);

          performRequest(requestSpec, url, function resultPair(err, result) {
            var pair = {
              from: item,
            };
            if (err) {
              pair.error = err;
            }
            else if (result) {
              pair.result = result;
            }
            callback(null, pair);
          });
        }, 3);

        var results = [];
        queue.push(params, function (err, result) {
          results.push(result);
        });

        queue.drain = function queueDone() {
          callback(null, results);
        };
      }
      else {
        callback(new Error('Iteration requests must have a source and query'));
      }
    }
  }

  function performRequest(requestSpec, url, callback) {
    if (requestSpec.remote) {
      if (typeof remoteHandler !== 'function') {
        callback(new Error('This endpoint doesn\'t support remote requests'));
        return;
      }
      remoteHandler(requestSpec.remote, {
        url: url,
        credentials: bulkRequest.auth.credentials
      }, function handleReply(reply) {
        if (reply && reply.isBoom) {
          reply = reply.output.payload;
        }
        callback(null, reply);
      });
    }
    else {
      var injectOptions = {
        url: url,
        method: 'GET',
        credentials: bulkRequest.auth.credentials
      };

      bulkRequest.server.inject(injectOptions, function(data) {
        callback(null, data.result);
      });
    }
  }

  // Build our task object
  for (var resourceName in requests) {
    var requestSpec = requests[resourceName];
    var worker = requestWorker.bind(this, requestSpec);

    var item;
    if (requestSpec.source) {
      item = [requestSpec.source, worker];
    }
    else {
      item = worker;
    }
    tasks[resourceName] = item;
  }


  mod_async.auto(tasks, function(error, results) {
    if (error) {
      reply(hapi.error.badRequest(error.message));
      return;
    }

    // Add debugging info
    if (bulkRequest.query._debug === 'true') {
      // Restore the path expressions
      for (var key in requests) {
        if (requests[key].query) {
          requests[key].query = requests[key].query.path;
        }
      }

      bulkResult.meta.requests = requests;
    }

    bulkResult.results = {};

    // Add the non-suppressed results
    for (var rkey in results) {
      if (!requests[rkey].suppress) {
        bulkResult.results[rkey] = results[rkey];
      }
    }

    reply(bulkResult);
  });
};

Bhulk.prototype.validateTree = function (requests) {
  var walked, current;
  for (var key in requests) {
    walked = [key];
    current = requests[key];
    while (current.source) {
      if (!requests[current.source]) {
        return new Error('Undefined request source "' + current.source + '"');
      }
      if (walked.indexOf(current.source) > -1) {
        walked.push(current.source);
        return new Error('Dependency loop: ' + walked.join(' -> '));
      }
      walked.push(current.source);
      current = requests[current.source];
    }
  }

  return null;
};

exports.pkg = require('./package.json');
exports.register = function (plugin, options, next) {
  var config = {
    path: '/bulk',
    routeConfig: {
      description: 'Bulk request',
      notes: 'Performs multiple requests'
    },
    remote: null
  };
  if (options) {
    _.merge(config, options);
  }

  var bulk = new Bhulk(plugin.hapi, config);
  plugin.route({
    method: 'GET',
    path: config.path,
    handler: bulk.bulkRequest.bind(bulk),
    config: config.routeConfig
  });

  next();
};
