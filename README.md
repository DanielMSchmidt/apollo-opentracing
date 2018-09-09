# apollo-opentracing [![npm version](https://badge.fury.io/js/apollo-opentracing.svg)](https://badge.fury.io/js/apollo-opentracing) [![Build Status](https://travis-ci.com/DanielMSchmidt/apollo-opentracing.svg?branch=master)](https://travis-ci.com/DanielMSchmidt/apollo-opentracing) [![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

- 🚀 Request & Field level resolvers are traced out of the box
- 🔍 Queries and results are logged, to make debugging easier
- ⚙️ Select which requests you want to trace
- 🔗 Spans transmitted through the HTTP Headers are picked up
- 🔧 Use the opentracing compatible tracer you like, e.g.
  - [jaeger](https://www.jaegertracing.io/)
  - [zipkin](https://github.com/DanielMSchmidt/zipkin-javascript-opentracing)
- 🦖 Support from node 6 on

## Installation

Run `npm install --save apollo-opentracing` given that you already setup an opentracing tracer accordingly.

## Setup

We need two types of tracer (which could be identical if you like):

- server: Only used for the root (the first span we will start)
- local: Used to start every other span

```diff
const { graphqlExpress } = require("apollo-server-express");
const {serverTracer, localTracer} = require("./tracer");
+const OpentracingExtension = require("apollo-opentracing").default;

app.use(
  "/graphql",
  bodyParser.json(),
  graphqlExpress({
    schema,
+   extensions: [() => new OpentracingExtension({
+     server: serverTracer,
+     local: localTracer,
+   })]
  })
)
```

## Connecting Services

![example image](demo.png)

To connect other services you need to use the opentracing [inject](http://opentracing.io/documentation/pages/api/cross-process-tracing.html) function of your tracer.
We pass the current span down to your resolvers as `context.span`, so you should use it.

You can also make use of it and add new logs or tags on the fly if you like.

## Selective Tracing

Sometimes you don't want to trace everything, so we provide ways to select if you want to start a span right now or not.

### By Request

If you construct the extension with `shouldTraceRequest` you get the option to opt-in or out on a request basis.
When you don't start the span for the request the field resolvers will also not be used.

The function is called with the same arguments as the `requestDidStart` function extensions can provide, which is documented [here](https://github.com/apollographql/apollo-server/blob/master/packages/graphql-extensions/src/index.ts#L35).

### By Field

There might be certain field resolvers that are not worth the tracing, e.g. when they get a value out of an object and need no further tracing. The function is called with the same arguments as your field resolver and you can get the name of the field by `info.fieldName`.

## Contributing

Please feel free to add issues with new ideas, bugs and anything that might come up.
Let's make performance measurement to everyone <3
