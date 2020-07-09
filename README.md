# Apollo Opentracing [![npm version](https://badge.fury.io/js/apollo-opentracing.svg)](https://badge.fury.io/js/apollo-opentracing) [![Build Status](https://travis-ci.com/DanielMSchmidt/apollo-opentracing.svg?branch=master)](https://travis-ci.com/DanielMSchmidt/apollo-opentracing) [![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release) [![All Contributors](https://img.shields.io/badge/all_contributors-4-orange.svg?style=flat-square)](#contributors)

Apollo Opentracing allows you to integrate open source baked performance tracing to your Apollo server based on industry standards for tracing.

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
We pass the current span down to your resolvers as `info.span`, so you should use it.

You can also make use of it and add new logs or tags on the fly if you like.
This may look something like this:

```js
myFieldResolver(source, args, context, info) {
  const headers = {...};

  const parentSpan = info.span;
  // please use the same tracer you passed down to the extension
  const networkSpan = tracer.startSpan("NetworkRequest:" + endpoint, {
    childOf: parentSpan
  });

  // Let's transfer the span information to the headers
  tracer.inject(
    networkSpan,
    YourOpentracingImplementation.FORMAT_HTTP_HEADERS,
    headers
  );

  return doNetworkRequest(endpoint, headers).then(result => {
    networkSpan.finish()
    return result;
  }, err => {
    networkSpan.log({
      error: true,
      errorMessage: err
    });

    networkSpan.finish();
    return err;
  });
}
```

## Selective Tracing

Sometimes you don't want to trace everything, so we provide ways to select if you want to start a span right now or not.

### By Request

If you construct the extension with `shouldTraceRequest` you get the option to opt-in or out on a request basis.
When you don't start the span for the request the field resolvers will also not be used.

The function is called with the same arguments as the `requestDidStart` function extensions can provide, which is documented [here](https://github.com/apollographql/apollo-server/blob/master/packages/graphql-extensions/src/index.ts#L35).

When the request is not traced there will also be no traces of the field resolvers.

### By Field

There might be certain field resolvers that are not worth the tracing, e.g. when they get a value out of an object and need no further tracing. To control if you want a field resolver to be traced you can pass the `shouldTraceFieldResolver` option to the constructor. The function is called with the same arguments as your field resolver and you can get the name of the field by `info.fieldName`. When you return false no traces will be made of this field resolvers and all underlying ones.

## Modifying span metadata

If you'd like to add custom tags or logs to span you can construct the extension with `onRequestResolve`. The function is called with two arguments: span and infos `onRequestResolve?: (span: Span, info: RequestStart)`

## Using your own request span

If you need to take control of initializing the request span (e.g because you need to use it during context initialization) you can do so by having creating it as `context.requestSpan`.

## Options

- `server`: Opentracing Tracer for the incoming request
- `local`: Opentracing Tracer for the local and outgoing requests
- `onFieldResolveFinish(error: Error | null, result: any, span: Span)`: Callback after a field was resolved
- `onFieldResolve(source: any, args: { [argName: string]: any }, context: SpanContext, info: GraphQLResolveInfo)`: Allow users to add extra information to the span
- `shouldTraceRequest` & `shouldTraceFieldResolver`: See [Selective Tracing](#selective-tracing)
- `onRequestResolve(span: Span, info: GraphQLRequestContext)`: Add extra information to the request span

## Contributing

Please feel free to add issues with new ideas, bugs and anything that might come up.
Let's make performance measurement to everyone <3

## Contributors

Thanks goes to these wonderful people ([emoji key](https://github.com/kentcdodds/all-contributors#emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="http://danielmschmidt.de/"><img src="https://avatars2.githubusercontent.com/u/1337046?v=4" width="100px;" alt=""/><br /><sub><b>Daniel Schmidt</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=DanielMSchmidt" title="Code">💻</a> <a href="#ideas-DanielMSchmidt" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/cliedeman"><img src="https://avatars2.githubusercontent.com/u/3578740?v=4" width="100px;" alt=""/><br /><sub><b>Ciaran Liedeman</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/issues?q=author%3Acliedeman" title="Bug reports">🐛</a> <a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=cliedeman" title="Code">💻</a> <a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=cliedeman" title="Tests">⚠️</a></td>
    <td align="center"><a href="http://juhp.net"><img src="https://avatars3.githubusercontent.com/u/453031?v=4" width="100px;" alt=""/><br /><sub><b>Jens Ulrich Hjuler Pedersen</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/issues?q=author%3AMultiply" title="Bug reports">🐛</a> <a href="#ideas-Multiply" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/DanielMSchmidt/apollo-opentracing/pulls?q=is%3Apr+reviewed-by%3AMultiply" title="Reviewed Pull Requests">👀</a></td>
    <td align="center"><a href="https://github.com/frances3006"><img src="https://avatars0.githubusercontent.com/u/9115596?v=4" width="100px;" alt=""/><br /><sub><b>Francesca</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=frances3006" title="Code">💻</a></td>
    <td align="center"><a href="https://analogic.al"><img src="https://avatars2.githubusercontent.com/u/84963?v=4" width="100px;" alt=""/><br /><sub><b>Ricardo Casares</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=ricardocasares" title="Code">💻</a></td>
    <td align="center"><a href="https://keybase.io/mwieczorek"><img src="https://avatars2.githubusercontent.com/u/7051680?v=4" width="100px;" alt=""/><br /><sub><b>Michał Wieczorek</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=mwieczorek" title="Code">💻</a></td>
    <td align="center"><a href="https://koen.pt"><img src="https://avatars2.githubusercontent.com/u/351038?v=4" width="100px;" alt=""/><br /><sub><b>Koen Punt</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=koenpunt" title="Code">💻</a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/zekenie"><img src="https://avatars2.githubusercontent.com/u/962281?v=4" width="100px;" alt=""/><br /><sub><b>Zeke Nierenberg</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=zekenie" title="Code">💻</a></td>
    <td align="center"><a href="https://app.sport-buddy.net"><img src="https://avatars3.githubusercontent.com/u/1945040?v=4" width="100px;" alt=""/><br /><sub><b>Tomáš Voslař</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=voslartomas" title="Code">💻</a></td>
    <td align="center"><a href="http://iam.benkimball.com/"><img src="https://avatars2.githubusercontent.com/u/40365?v=4" width="100px;" alt=""/><br /><sub><b>Ben Kimball</b></sub></a><br /><a href="https://github.com/DanielMSchmidt/apollo-opentracing/commits?author=benkimball" title="Code">💻</a></td>
  </tr>
</table>

<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification. Contributions of any kind welcome!

## License

[MIT](LICENSE)
