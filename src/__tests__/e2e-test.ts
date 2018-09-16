import { gql } from "apollo-server";
import { runQuery } from "apollo-server-core";
import { globalTracer } from "opentracing";
import { makeExecutableSchema } from "graphql-tools";
import ApolloOpentracing from "..";

const books = [
  {
    title: "Harry Potter and the Chamber of Secrets",
    author: "J.K. Rowling"
  },
  {
    title: "Jurassic Park",
    author: "Michael Crichton"
  }
];

const typeDefs = gql`
  type Book {
    title: String
    author: String
  }
  type Query {
    books: [Book]
  }
`;

const resolvers = {
  Query: {
    books: () => books
  }
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

describe("e2e test", () => {
  beforeEach(() => {
    // const span = {
    //   finish: jest.fn(),
    //   log: jest.fn()
    // };
    // local = {
    //   span,
    //   startSpan: jest.fn(() => span),
    //   inject: jest.fn(),
    //   extract: jest.fn()
    // };
  });

  it("test", async () => {
    const tracer = globalTracer();

    const rootValue = {};
    const queryString = `
      {
        books {
          title
          author
        }
      }
    `;
    const context = {};
    const variables = {};

    const options = {
      schema,
      // Use raw string so we can eventually confirm that parsing is traced
      queryString,
      rootValue,
      context,
      variables,
      // TODO: better request mock
      request: {
        url: "",
        method: "POST",
        headers: {}
      } as any,
      extensions: [
        () =>
          new ApolloOpentracing({
            server: tracer,
            local: tracer
          })
      ]
    };

    const result = await runQuery(options);

    console.log(JSON.stringify(result));
  });
});
