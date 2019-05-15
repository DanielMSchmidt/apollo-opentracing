import * as express from "express";
import * as request from "supertest";
import { ApolloServer } from "apollo-server-express";
import ApolloOpentracing from "../";
import spanSerializer from "../test/span-serializer";
import { MockSpan, MockSpanTree } from "../test/types";

expect.addSnapshotSerializer(spanSerializer);

let mockSpanId = 1;

// Stable spanId's
beforeEach(() => {
  mockSpanId = 1;
});

const buildSpanTree = (spans: MockSpan[]) => {
  // TODO we currently assume there is only one null parent entry.
  // The root span

  let rootSpan = null;

  const spansByParentId = spans.reduce((acc, span) => {
    // Check for root
    if (span.parentId) {
      if (acc.has(span.parentId)) {
        acc.get(span.parentId).push(span);
      } else {
        acc.set(span.parentId, [span]);
      }
    } else {
      rootSpan = span;
    }

    return acc;
  }, new Map<number, MockSpan[]>());

  expect(rootSpan).toBeDefined();

  const tree = {
    ...rootSpan,
    children: []
  };

  buildTree(tree, spansByParentId);

  // Lost Spans
  expect(spansByParentId.size).toBe(0);

  return tree;
};

const buildTree = (
  parent: MockSpanTree,
  spansByParentId: Map<number, MockSpan[]>
) => {
  if (spansByParentId.has(parent.id)) {
    const spans = spansByParentId.get(parent.id);
    spansByParentId.delete(parent.id);

    // TODO: do we need to sort?
    for (const span of spans) {
      const node = {
        ...span,
        children: []
      };

      parent.children.push(node);
      buildTree(node, spansByParentId);
    }
  }
};

class MockTracer {
  spans: MockSpan[];
  constructor() {
    this.spans = [];
  }

  extract() {
    // TODO: make extraced spans testable
    return null;
  }

  startSpan(name, options) {
    const spanId = mockSpanId++;

    this.spans.push({
      id: spanId,
      parentId: options && options.childOf && options.childOf.id,
      name,
      options,
      logs: [],
      tags: [],
      finished: false
    });

    const self = this;

    return {
      log(object) {
        self.spans.find(span => span.id === spanId).logs.push(object);
      },

      setTag(key, value) {
        self.spans.find(span => span.id === spanId).tags.push({"key": key, "value": value})
      },

      id: spanId,
      // Added for debugging
      name: name,

      finish() {
        self.spans.find(span => span.id === spanId).finished = true;
      }
    };
  }
}

function createApp({ tracer, ...params }) {
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
        },
        b() {
          return {
            four: "4"
          };
        },

        as() {
          return [
            {
              one: "1",
              two: "2"
            },
            {
              one: "I",
              two: "II"
            },
            {
              one: "eins",
              two: "zwei"
            }
          ];
        }
      }
    },
    extensions: [
      () => new ApolloOpentracing({ ...params, server: tracer, local: tracer })
    ]
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

  it("correct span nesting", async () => {
    const tracer = new MockTracer();
    const app = createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          one
          two
        }
      }`
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("does not start a field resolver span if the parent field resolver was not traced", async () => {
    const tracer = new MockTracer();
    const shouldTraceFieldResolver = (source, args, ctx, info) => {
      if (info.fieldName === "a") {
        return false;
      }
      return true;
    };

    const app = createApp({ tracer, shouldTraceFieldResolver });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          one
          two
        }
        b {
          four
        }
      }`
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("implements traces for arrays", async () => {
    const tracer = new MockTracer();
    const app = createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        as {
          one
          two
        }
      }`
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("alias works", async () => {
    const tracer = new MockTracer();
    const app = createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          uno: one
          two
        }
      }`
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("alias with fragment works", async () => {
    const tracer = new MockTracer();
    const app = createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `
        fragment F on A {
          dos: two
        }

        query {
        a {
          ...F
        }
      }`
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });
});
