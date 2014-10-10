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
  * `iterationLimit` - the maximum number of iteration requests that should be allowed, defaults to `10`.

# Performing bulk requests

A sample use of Bhulk (the query parameters as json for easier reading):

```json
{
  "stories": "/collections/5/stories?fields=entityId,entityType,addedBy",
  "posts": "/posts?ids=${,}&fields=title,url",
  "posts.source": "stories",
  "posts.query": ".[*](eq(@.entityType, 'post')).entityId",
  "authors": "/users?ids=${,}",
  "authors.source": "stories",
  "authors.query": ".*.addedBy",
  "_debug": "true"
}
```

All requests in Bhulk are named here we have "stories", "posts", and "authors". A request can have a `source`, which is a dependency on another request, whose result then can be used to build the request. The what values to select from the sources result is determined by the `query`, which is an [OBPath](https://www.npmjs.org/package/obpath.js) expression. So in the above exaple the "posts" request has "stories" and a `source` and it will take all "entityId" values from objects in the result that have an "entityType" that matches 'post'. The `${,}` placeholder in the "posts" url "/posts?ids=${,}&fields=title,url,content,image" will be replaced with the unique values from the JSONPath query, separated by comma. So the actual request that will be made could look something like this: "/posts?ids=123,234&fields=title,url,content,image". It's also possible to suppress the results of requests with a suppress parameter, for stories that would look like this: "stories.suppress=true".

The "_debug" parameter causes bhulk to output metadata about the requests; how they are interpreted and what the final url resolves to.

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
        "query": ".[*](eq(@.entityType, 'post')).entityId",
        "realUrl": "/posts?ids=123,234&fields=title,url"
      },
      "authors": {
        "url": "/users?ids=${,}",
        "source": "stories",
        "query": ".*.addedBy",
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

## Iteration

In cases where it isn't practical or possible to make a bulk request, like the one in the posts example above, it's also possible to make one separate request per path expression match. This should be used sparingly, bulk loading is always preferred.

A sample use of iteration (the query parameters as json for easier reading):

```json
{
  "collections": "/users/74841/collections?count=10",
  "collections.remote": "v1-collections",
  "stories": "/collections/${.}/stories?count=3",
  "stories.remote": "v1-collections",
  "stories.each": "true",
  "stories.source": "collections",
  "stories.query": ".result[*].id",
  "posts": "/posts?ids=${,}&fields=id,url,title,image",
  "posts.remote": "v1-core",
  "posts.source": "stories",
  "posts.query": "[*].result.result[*].storyId"
}
```

Here we fetch a users ten first collections (remember the `iterationLimit` here). Then we issue a request for the three first stories for each of the returned collections. As this isn't a "bulk" request we're not joining the result of the obpath query, The "${.}" (period instead of comma) placeholder uses the matched item directly instead.

The posts request then collects all the storyIds, and loads the corresponding posts with a bulk load requests.

```json
{
  "meta": {
    "requests": {
      "collections": {
        "remote": "v1-collections",
        "url": "/users/74841/collections?count=10"
      },
      "stories": {
        "each": true,
        "query": ".result[*].id",
        "url": "/collections/${.}/stories?count=3",
        "remote": "v1-collections",
        "realUrls": [
          "/collections/53f60850458a0c81cbe8d7b2/stories?count=3",
          "/collections/53f5f9d6c651260ebf21c255/stories?count=3",
          "/collections/53ec78f8bfb0999d51ec95a0/stories?count=3"
        ],
        "source": "collections"
      },
      "posts": {
        "url": "/posts?ids=${,}&fields=id,url,title,image",
        "remote": "v1-core",
        "source": "stories",
        "realUrl": "/posts?ids=2576%2C123&fields=id,url,title,image",
        "query": "[*].result.result[*].storyId"
      }
    }
  },
  "results": {
    "collections": {
      "meta": {},
      "result": [
        {
          "authors": [
            {
              "added": 1408632912901,
              "level": 1,
              "id": "53f60850458a0c81cbe8d7b3",
              "userId": 74841
            }
          ],
          "created": 1408632912901,
          "id": "53f60850458a0c81cbe8d7b2",
          "followers": [],
          "name": "Collection with posts",
          "public": true,
          "modified": 1408632912901,
          "version": 0
        },
        {
          "version": 0,
          "public": true,
          "modified": 1408629206001,
          "name": "Collection with posts",
          "id": "53f5f9d6c651260ebf21c255",
          "followers": [
            "12788",
            "74841"
          ],
          "created": 1408629206001,
          "authors": [
            {
              "userId": 74841,
              "added": 1408629206001,
              "level": 1,
              "id": "53f5f9d6c651260ebf21c256"
            }
          ]
        },
        {
          "version": 0,
          "public": true,
          "modified": 1408006392775,
          "name": "Awesome collection",
          "id": "53ec78f8bfb0999d51ec95a0",
          "followers": [
            "12788",
            "74841"
          ],
          "created": 1408006392775,
          "authors": [
            {
              "userId": 74841,
              "added": 1408006392775,
              "id": "53ec78f8bfb0999d51ec95a1",
              "level": 1
            }
          ]
        }
      ]
    },
    "stories": [
      {
        "result": {
          "meta": {},
          "result": [
            {
              "addedBy": 74841,
              "public": true,
              "collectionId": "53f60850458a0c81cbe8d7b2",
              "version": 0,
              "storyId": "2576",
              "id": "53f6086f458a0c81cbe8d7b4",
              "added": 1408632943924
            }
          ]
        },
        "from": "53f60850458a0c81cbe8d7b2"
      },
      {
        "from": "53f5f9d6c651260ebf21c255",
        "result": {
          "result": [
            {
              "added": 1408629219268,
              "id": "53f5f9e3c651260ebf21c257",
              "version": 0,
              "storyId": "2576",
              "collectionId": "53f5f9d6c651260ebf21c255",
              "public": true,
              "addedBy": 74841
            }
          ],
          "meta": {}
        }
      },
      {
        "result": {
          "meta": {
            "nextUrl": "/collections/53ec78f8bfb0999d51ec95a0/stories?count=3&before=53f5e8366ceaa8c9a5cc2eca"
          },
          "result": [
            {
              "addedBy": 74841,
              "public": true,
              "version": 0,
              "collectionId": "53ec78f8bfb0999d51ec95a0",
              "storyId": "123",
              "id": "542bf8f63bc045cd4e210336",
              "added": 1412167926784
            },
            {
              "public": true,
              "addedBy": 74841,
              "added": 1412167854006,
              "version": 0,
              "collectionId": "53ec78f8bfb0999d51ec95a0",
              "storyId": "2576",
              "id": "542bf8ae3bc045cd4e210335"
            },
            {
              "added": 1408624694894,
              "id": "53f5e8366ceaa8c9a5cc2eca",
              "collectionId": "53ec78f8bfb0999d51ec95a0",
              "version": 0,
              "storyId": "2576",
              "public": true,
              "addedBy": 74841
            }
          ]
        },
        "from": "53ec78f8bfb0999d51ec95a0"
      }
    ],
    "posts": [
      {
        "id": "2576",
        "title": "11e juli 2012 – på Sardinien",
        "url": "http://kenzas.se/2012/07/11/11e-juli-2012-pa-sardinien/",
        "image": "http://kenzas.se/wp-content/uploads/2012/07/IMG_1672.jpg"
      },
      {
        "id": "123",
        "url": "http://emmatokfrans.blogg.se/2011/august/vardag.html",
        "image": "http://emmatokfrans.blogg.se/images/2011/dsc01249_162112190.jpg",
        "title": "Vardag"
      }
    ]
  }
}
```
