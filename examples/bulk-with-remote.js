/* jshint node: true */
'use strict';

var lib = {
  async: require('async'),
  hapi: require('hapi'),
  http: require('http'),
  url: require('url'),
  request: require('request'),
  bhulk: require('../')
};

var serverOne = lib.hapi.createServer('0.0.0.0', 20180);
var serverTwo = lib.hapi.createServer('0.0.0.0', 20280);

serverOne.route([
  {
    path: '/listing',
    method: 'GET',
    handler: getListing
  },
  {
    path: '/entities',
    method: 'GET',
    handler: getEntities
  }
]);

serverTwo.route({
  path: '/users',
  method: 'GET',
  handler: getUsers
});

lib.async.auto({
  // Register the bhulk plugin
  bhulk: function registerBulk(callback) {
    // We have to register manually instead of using require as we're running from
    // inside bhulk.
    serverOne.pack.register({
      name: 'bhulk',
      version: '0.0.0',
      register: lib.bhulk.register
    }, {
      remote: handleRemoteRequest
    }, callback);
  },
  // Start server one
  one: ['bhulk', function startOne(callback) {
    serverOne.start(callback);
  }],
  // Start server two
  two: function startTwo(callback) {
    serverTwo.start(callback);
  },
  // Make the sample request
  request: ['one', 'two', makeRequest]
}, function startResult(error, results) {
  if (error) {
    console.error('Failed to run example:', error);
    process.exit(1);
  }

  // Output the result if we were successful
  console.log(JSON.stringify(results.request, null, '  '));

  // Stop our servers
  serverOne.stop();
  serverTwo.stop();
});

// Makes the bulk request
function makeRequest(callback) {
  lib.request({
    url: 'http://127.0.0.1:20180/bulk',
    json: true,
    qs: {
      'listing': '/listing',
      'entities': '/entities?ids=${,}',
      'entities.source': 'listing',
      'entities.query': '$.*.id',
      'authors': '/users?ids=${,}',
      'authors.remote': 'two',
      'authors.source': 'entities',
      'authors.query': '$.*.by'
    }
  }, function requestResult(error, request, result) {
    callback(error, result);
  });
}

// Remote handler for server one, it only accepts one remote: 'two'.
function handleRemoteRequest(remote, request, reply) {
  if (remote !== 'two') {
    reply(lib.hapi.error.badRequest('Unknown remote "' + remote + '"'));
    return;
  }

  lib.request({
    url: lib.url.resolve('http://127.0.0.1:20280/', request.url),
    json: true
  }, function requestResult(error, request, result) {
    reply(result);
  });
}

/*
 * Mock route handlers that output some static data.
**/

function getListing(request, reply) {
  reply([
    {"id":123},
    {"id":234}
  ]);
}

function getEntities(request, reply) {
  var result = [];
  var db = {
    "123": {
      "id": 123,
      "name": "Foo",
      "by": 1001
    },
    "234": {
      "id": 234,
      "name": "Bar",
      "by": 1002
    }
  };

  var ids = request.query.ids.split(',');
  ids.forEach(function addResult(id) {
    if (db[id]) result.push(db[id]);
  });

  reply(result);
}

function getUsers(request, reply) {
  var result = [];
  var db = {
    "1001": {
      "id": 1001,
      "name": "Jane"
    },
    "1002": {
      "id": 1002,
      "name": "John"
    }
  };

  var ids = request.query.ids.split(',');
  ids.forEach(function addResult(id) {
    if (db[id]) result.push(db[id]);
  });

  reply(result);
}
