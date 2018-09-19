import * as express from "express";
import * as request from "supertest";
import { ApolloServer } from "apollo-server-express";
import ApolloOpentracing from "../";
import * as bodyParser from "body-parser";
import { makeExecutableSchema } from "graphql-tools";

class MockTracer {
  spans: Object[];
  constructor() {
    this.spans = [];
  }

  extract() {
    // TODO: make extraced spans testable
    return null;
  }

  startSpan(name, options) {
    this.spans.push({ name, options, logs: [], finished: false });
    const self = this;

    return {
      log(object) {
        self.spans.find(span => span.name === name).logs.push(object);
      },

      finish() {
        self.spans.find(span => span.name === name).finished = true;
      }
    };
  }
}

function createApp({ tracer }) {
  const app = express();

  const server = new ApolloServer({
    typeDefs: `
      type A {
        one: String
        two: String
        three: [B]
      }

      type B {
        four: String  
      }

      type Query {
        a: A
        b: B
        as: [A]
        bs: [B]
      }
    `,
    resolvers: {
      Query: {
        a() {
          return {
            one: "1",
            two: "2",
            three: [{ four: "4" }, { four: "IV" }]
          };
        }
      }
    },
    extensions: [() => new ApolloOpentracing({ server: tracer, local: tracer })]
  });

  server.applyMiddleware({ app });

  return app;
}

describe("integration with apollo-server", () => {
  it("closes all spans", async () => {
    const tracer = new MockTracer();
    const app = createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          one
        }
      }`
      })
      .expect(200);

    expect(tracer.spans.length).toBe(3);
    expect(tracer.spans.filter(span => span.finished).length).toBe(3);
  });
});
