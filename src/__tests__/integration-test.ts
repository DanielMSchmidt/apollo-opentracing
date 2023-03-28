import * as express from "express";
import * as request from "supertest";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from '@apollo/server/express4';
import { json } from 'body-parser';
import { Tracer } from "opentracing";
import { MockSpan, MockSpanTree } from "../test/types";
import spanSerializer from "../test/span-serializer";
import ApolloOpentracing, { InitOptions } from "../";

expect.addSnapshotSerializer(spanSerializer);

let mockSpanId = 1;

// Stable spanId's
beforeEach(() => {
  mockSpanId = 1;
});

const buildSpanTree = (spans: MockSpan[]) => {
  // TODO we currently assume there is only one null parent entry.
  const rootSpan = spans.find((span) => !span.parentId);
  if (!rootSpan) {
    throw new Error("No root span found");
  }
  const spansByParentId = spans.reduce((acc, span) => {
    // Check for root
    if (span.parentId) {
      if (acc.has(span.parentId)) {
        acc.get(span.parentId)?.push(span);
      } else {
        acc.set(span.parentId, [span]);
      }
    }

    return acc;
  }, new Map<number, MockSpan[]>());

  expect(rootSpan).toBeDefined();

  const tree: MockSpanTree = {
    ...rootSpan,
    children: [],
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
    if (!spans) {
      throw new Error(
        "Could not find the spans for parent " +
          parent.name +
          " with id " +
          parent.id
      );
    }
    spansByParentId.delete(parent.id);

    // TODO: do we need to sort?
    for (const span of spans) {
      const node = {
        ...span,
        children: [],
      };

      parent.children.push(node);
      buildTree(node, spansByParentId);
    }
  }
};

function buildEmptySpan(
  id: number,
  name: string,
  parentId?: number,
  options?: any
) {
  return {
    id,
    parentId,
    name,
    options,
    logs: [],
    tags: [],
    finished: false,
  };
}

class MockTracer {
  spans: MockSpan[];
  constructor() {
    this.spans = [];
  }

  extract(_idk: any, header: Record<string, string>) {
    // we use this as a name and -1 as id
    const externalSpanId = header["x-b3-spanid"];
    if (!externalSpanId) {
      return null;
    }

    const externalSpan = buildEmptySpan(-1, externalSpanId);
    this.spans.push(externalSpan);
    return externalSpan;
  }

  startSpan(name: string, options: any) {
    const spanId = mockSpanId++;

    this.spans.push(
      buildEmptySpan(spanId, name, options?.childOf?.id, options)
    );

    const self = this;

    return {
      log(object: any) {
        self.spans.find((span) => span.id === spanId)?.logs.push(object);
      },

      setTag(key: string, value: any) {
        self.spans
          .find((span) => span.id === spanId)
          ?.tags.push({ key: key, value: value });
      },

      id: spanId,
      // Added for debugging
      name,

      finish() {
        const span = self.spans.find((span) => span.id === spanId);
        if (span) {
          span.finished = true;
        }
      },
    };
  }
}

interface EmptyContext {}

async function createApp({
  tracer,
  ...params
}: { tracer: MockTracer } & Omit<
  InitOptions<EmptyContext>,
  "server" | "local"
>) {
  const app = express();

  const server = new ApolloServer<EmptyContext>({
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
        e: B
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
            three: [{ four: "4" }, { four: "IV" }],
          };
        },
        b() {
          return {
            four: "4",
          };
        },
        e() {
          return new Error("error!");
        },

        as() {
          return [
            {
              one: "1",
              two: "2",
            },
            {
              one: "I",
              two: "II",
            },
            {
              one: "eins",
              two: "zwei",
            },
          ];
        },
      },
    },
    plugins: [
      ApolloOpentracing({
        ...params,
        server: tracer as unknown as Tracer,
        local: tracer as unknown as Tracer,
      }),
    ],
  });
  await server.start();
  app.use('/graphql', json(), expressMiddleware(server));

  return app;
}

describe("integration with @apollo/server", () => {
  it("closes all spans", async () => {
    const tracer = new MockTracer();
    const app = await createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          one
        }
      }`,
      })
      .expect(200);

    expect(tracer.spans.length).toBe(3);
    expect(tracer.spans.filter((span) => span.finished).length).toBe(3);
  });

  it("correct span nesting", async () => {
    const tracer = new MockTracer();
    const app = await createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          one
          two
        }
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("does not start a field resolver span if the parent field resolver was not traced", async () => {
    const tracer = new MockTracer();
    const shouldTraceFieldResolver = (
      _source: any,
      _args: any,
      _ctx: any,
      info: any
    ) => {
      if (info.fieldName === "a") {
        return false;
      }
      return true;
    };

    const app = await createApp({ tracer, shouldTraceFieldResolver });
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
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("implements traces for arrays", async () => {
    const tracer = new MockTracer();
    const app = await createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        as {
          one
          two
        }
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("alias works", async () => {
    const tracer = new MockTracer();
    const app = await createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
        a {
          uno: one
          two
        }
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("alias with fragment works", async () => {
    const tracer = new MockTracer();
    const app = await createApp({ tracer });
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
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });

  it("onFieldResolve & onFieldResolveFinish", async () => {
    const tracer = new MockTracer();
    const onFieldResolve = jest.fn(
      (_s: any, _args: any, _context: any, info: any) => {
        info.span.log({ onFieldResolve: "yes" });
      }
    );
    const onFieldResolveFinish = jest.fn(
      (_err: any, _result: any, span: any) => {
        span.log({ onFieldResolveFinish: "yes" });
      }
    );

    const app = await createApp({
      tracer,
      onFieldResolve,
      onFieldResolveFinish,
    });
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
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
    expect(onFieldResolve).toHaveBeenCalledTimes(5);
    expect(onFieldResolveFinish).toHaveBeenCalledTimes(5);
  });

  it("shouldTraceRequest disables tracing", async () => {
    const tracer = new MockTracer();
    const shouldTraceRequest = jest.fn(() => false);
    const app = await createApp({ tracer, shouldTraceRequest });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
          a {
            one
          }
      }`,
      })
      .expect(200);

    expect(shouldTraceRequest).toHaveBeenCalledTimes(1);
    expect(tracer.spans.length).toBe(0);
  });

  it("onRequestResolve", async () => {
    const tracer = new MockTracer();
    const onRequestResolve = jest.fn((span: any) => {
      span.log({ onRequestResolve: "yes" });
    });

    const app = await createApp({ tracer, onRequestResolve });
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
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
    expect(onRequestResolve).toHaveBeenCalledTimes(1);
  });

  it("onRequestError", async () => {
    const tracer = new MockTracer();
    const onRequestError = jest.fn((span: any) => {
      span.log({ onRequestError: "yes" });
    });

    const app = await createApp({ tracer, onRequestError });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .send({
        query: `query {
          e {
            four
          }
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
    expect(onRequestError).toHaveBeenCalledTimes(1);
  });

  it("picks up external spans", async () => {
    const tracer = new MockTracer();

    const app = await createApp({ tracer });
    await request(app)
      .post("/graphql")
      .set("Accept", "application/json")
      .set("x-b3-traceid", "external")
      .set("x-b3-spanid", "external")
      .send({
        query: `query {
          a {
            one
          }
      }`,
      })
      .expect(200);

    const tree = buildSpanTree(tracer.spans);
    expect(tree).toMatchSnapshot();
  });
});
