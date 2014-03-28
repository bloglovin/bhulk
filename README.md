# Bhulk - Bulk requests for hapi

Bulk request plugin for hapi. Bhulk is an alternative to [bassmaster](https://github.com/spumko/bassmaster) and the main difference is that Bhulk only performs and responds to GET-requests. So in situations where you want a way to fetch things in bulk in a more RESTful way Bhulk might be a good alternative.

# Using the plugin

Install bhulk in your project `npm install -S bhulk` and then require it into your server:

```javascript
server.pack.require('bhulk', {
  path: '/bulk',
}, function setupDone(error) {
  if (error) throw error;
  console.log('Bhulk smash!');
})
```

Passing the path:'/bulk' option is not necessary as it is the default. But there are a couple of options for controlling the behaviour of Bhulk:

  * `path` - the path for the Bhulk route, defaults to '/bulk'.
  * `routeConfig` - configuration options for the route, will be merged with the default route config, see the "config" section of [Route options](https://github.com/spumko/hapi/blob/master/docs/Reference.md#route-options) in the hapi docs.
  * `remote` - by default Bhulk only performs subrequests to the server it's configured for, but by passing in a `remote` you can specify a function that can call remote services as part of a bulk request. The signature of the function is `remote(remote, request, reply)`. The request object has two attributes: `url` and `credentials`.

# Performing bulk requests

A sample use of Bhulk (the query parameters as json for easier reading):

```json
{
  "stories": "/collections/5/stories?fields=entityId,entityType,addedBy",
  "posts": "/posts?ids=${,}&fields=title,url",
  "posts.source": "stories",
  "posts.query": "$.[?(@.entityType=='post')].entityId",
  "authors": "/users?ids=${,}",
  "authors.source": "stories",
  "authors.query": "$.*.addedBy"
}
```

All requests in Bhulk are named here we have "stories", "posts", and "authors". A request can have a `source`, which is a dependency on another request, whose result then can be used to build the request. The what values to select from the sources result is determined by the `query`, which is a [JSONPath](https://www.npmjs.org/package/JSONPath) expression. So in the above exaple the "posts" request has "stories" and a `source` and it will take all "entityId" values from objects in the result that have an "entityType" that matches 'post'. The `${,}` placeholder in the "posts" url "/posts?ids=${,}&fields=title,url,content,image" will be replaced with the unique values from the JSONPath query, separated by comma. So the actual request that will be made could look something like this: "/posts?ids=123,234&fields=title,url,content,image".

Requests will be executed in parallel when possible. The "posts" and "authors" requests in the above example will both be made as soon as their `source` request has finished.

The result will look like this:

```json
{
  "meta": {
    "requests": {
      "stories": {
        "url": "/collections/5/stories?fields=entityId,entityType,addedBy"
      },
      "posts": {
        "url": "/posts?ids=${,}&fields=title,url",
        "source": "stories",
        "query": "$.[?(@.entityType=='post')].entityId",
        "realUrl": "/posts?ids=123,234&fields=title,url"
      },
      "authors": {
        "url": "/users?ids=${,}",
        "source": "stories",
        "query": "$.result.*.addedBy",
        "realUrl": "/users?ids=1001"
      }
    }
  },
  "results": {
    "stories": [
      {"entityId": 123, "entityType": "post", "addedBy": 1001},
      {"entityId": 234, "entityType": "post", "addedBy": 1001}
    ],
    "posts": [
      {"title":"Foo", "url":"http://example.com/foo"},
      {"title":"Bar", "url":"http://example.com/bar"}
    ],
    "authors": [
      {"id": 1001, "name": "Jane Doe", "avatar": "http://example.com/jane.png"}
    ]
  }
}
```
