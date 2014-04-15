/* jshint node: true */
'use strict';

var lib = {
  async: require('async'),
  jsonPath: require('JSONPath'),
  lodash: require('lodash')
};
var _ = lib.lodash;

function Bhulk(hapi, config) {
  this.hapi = hapi;
  this.config = config;
}

Bhulk.register = function (plugin, options, next) {
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

Bhulk.prototype.bulkRequest = function (bulkRequest, reply) {
  var bulkResult = {
    meta: {}
  };
  var hapi = this.hapi;
  var requests = {};
  var remoteHandler = this.config.remote;

  for (var key in bulkRequest.query) {
    var segments = key.split('.');
    var value = bulkRequest.query[key];
    var request = requests[segments[0]] = requests[segments[0]] || {};

    if (segments.length == 1) {
      request.url = value;
    }
    else if (segments.length == 2) {
      if (segments[1] == 'source') {
        request.source = value;
      }
      else if (segments[1] == 'query') {
        request.query = value;
      }
      else if (segments[1] == 'remote') {
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
    if (placeholder == ',') {
      value = _.uniq(params).join(placeholder);
    }
    return encodeURIComponent(value);
  }

  function requestWorker(requestSpec, callback, sources) {
    var url = requestSpec.url;
    if (requestSpec.source && requestSpec.query) {
      var data = sources[requestSpec.source];

      // Jshint thinks that the jsonPath.eval is a JavaScript eval.
      // jshint -W061
      var params = lib.jsonPath.eval(data, requestSpec.query);
      // jshint +W061

      url = requestSpec.url.replace(urlReplacement, function(match, placeholder) {
        return replace(placeholder, params);
      });
      if (url != requestSpec.url) {
        requestSpec.realUrl = url;
      }
    }

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


  lib.async.auto(tasks, function(error, results) {
    if (error) {
      reply(hapi.error.badRequest(error.message));
      return;
    }

    bulkResult.meta.requests = requests;
    bulkResult.results = results;

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

module.exports = Bhulk;
