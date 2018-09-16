const graphqlExpress = require("apollo-server-express/dist/expressApollo")
  .graphqlExpress;

import ApolloOpentracing from "../";

import { Request } from "jest-express/lib/request";
import { Response } from "jest-express/lib/response";
// import { graphqlExpress } from "apollo-server-express";
import { makeExecutableSchema } from "graphql-tools";

function queryMiddleware(tracer) {
  return queryString => {
    const request = new Request();
    request.setMethod("POST");
    request.setBody(queryString);
    const response = new Response();

    const middleware = graphqlExpress({
      schema: makeExecutableSchema({
        typeDefs: `

        type Query {
            a: String
            b: String
            c: String
        }
        `,
        resolvers: {
          Query: {
            a(_obj, _args, _context) {
              return "ValueA";
            },
            b(_obj, _args, _context) {
              return "ValueB";
            },
            c(_obj, _args, _context) {
              return "ValueC";
            }
          }
        }
      }),
      extensions: [
        () => new ApolloOpentracing({ server: tracer, local: tracer })
      ]
    });

    middleware(request, response, jest.fn());

    return {
      request,
      response
    };
  };
}

function Tracer() {
  this.spans = [];
  this.startSpan = (name, options) => {
    this.spans.push({ name, options, finished: false });

    return {
      finish() {
        this.spans.find(span => span.name === name).finished = true;
      }
    };
  };

  return this;
}

describe("Integration", () => {
  it("handles unnested requests", () => {
    const tracer = new Tracer();
    queryMiddleware(tracer)(`
    query {
        a
        b
        c
    }
    `);

    expect(tracer.spans).toEqual([]);
  });
});
