import ApolloOpentracing from "..";
describe("Apollo Tracing", () => {
  let server, local, tracingMiddleware;
  beforeEach(() => {
    const span = {
      finish: jest.fn(),
      log: jest.fn()
    };

    server = {
      span,
      startSpan: jest.fn(() => span),
      inject: jest.fn(),
      extract: jest.fn()
    };

    local = {
      span,
      startSpan: jest.fn(() => span),
      inject: jest.fn(),
      extract: jest.fn()
    };

    tracingMiddleware = new ApolloOpentracing({
      server,
      local
    });
  });

  describe("construction", () => {
    it("fails without tracers", () => {
      expect(() => {
        new ApolloOpentracing();
      }).toThrowErrorMatchingInlineSnapshot(
        `"ApolloOpentracing needs a server tracer, please provide it to the constructor. e.g. new ApolloOpentracing({ server: serverTracer, local: localTracer })"`
      );

      expect(() => {
        new ApolloOpentracing({});
      }).toThrowErrorMatchingInlineSnapshot(
        `"ApolloOpentracing needs a server tracer, please provide it to the constructor. e.g. new ApolloOpentracing({ server: serverTracer, local: localTracer })"`
      );
    });

    it("fails with a missing tracer", () => {
      expect(() => {
        new ApolloOpentracing({ local });
      }).toThrowErrorMatchingInlineSnapshot(
        `"ApolloOpentracing needs a server tracer, please provide it to the constructor. e.g. new ApolloOpentracing({ server: serverTracer, local: localTracer })"`
      );

      expect(() => {
        new ApolloOpentracing({ server });
      }).toThrowErrorMatchingInlineSnapshot(
        `"ApolloOpentracing needs a local tracer, please provide it to the constructor. e.g. new ApolloOpentracing({ server: serverTracer, local: localTracer })"`
      );
    });

    it("constructs with enough arguments", () => {
      new ApolloOpentracing({ local, server });
    });
  });

  describe("request spans", () => {
    it("starts and finishes a request spans if there are no errors", () => {
      const cb = tracingMiddleware.requestDidStart({ queryString: "query {}" });
      expect(server.startSpan).toHaveBeenCalled();
      expect(local.startSpan).not.toHaveBeenCalled();
      expect(server.span.log).toHaveBeenCalledWith({ queryString: "query {}" });

      cb();
      expect(server.span.finish).toHaveBeenCalled();
    });
    it("starts and finishes a request spans if there are errors", () => {
      const cb = tracingMiddleware.requestDidStart({ queryString: "query {}" });
      expect(server.startSpan).toHaveBeenCalled();
      expect(local.startSpan).not.toHaveBeenCalled();
      expect(server.span.log).toHaveBeenCalledWith({ queryString: "query {}" });

      cb(new Error("ups"));
      expect(server.span.finish).toHaveBeenCalled();
    });
  });

  describe("field resolver", () => {
    it("starts a new local span for the field", () => {
      tracingMiddleware.willResolveField({}, {}, {}, {});
      expect(server.startSpan).not.toHaveBeenCalled();
      expect(local.startSpan).toHaveBeenCalled();
    });

    it("uses the 'fieldname' as the span name if no fieldname can be found", () => {
      tracingMiddleware.willResolveField({}, {}, {}, {});
      expect(local.startSpan).toHaveBeenCalledWith("field", {
        childOf: undefined
      });
    });

    it("uses the name as the span name if no fieldname can be found", () => {
      tracingMiddleware.willResolveField(
        {},
        {},
        {},
        {
          fieldName: "myField"
        }
      );
      expect(local.startSpan).toHaveBeenCalledWith("myField", {
        childOf: undefined
      });
    });

    it("starts the span as a child span", () => {
      tracingMiddleware.willResolveField({}, {}, { span: { id: "42" } }, {});
      expect(local.startSpan).toHaveBeenCalledWith("field", {
        childOf: { id: "42" }
      });
    });

    it("adds the span to the context", () => {
      const ctx = {};
      tracingMiddleware.willResolveField({}, {}, ctx, {});
      expect(ctx.span).toBeDefined();
    });

    it("logs an error", () => {
      const err = new Error("my-error");

      const cb = tracingMiddleware.willResolveField({}, {}, {}, {});
      cb(err);

      expect(local.span.log).toHaveBeenCalledWith({
        error: JSON.stringify(err)
      });
    });

    it("logs a result", () => {
      const result = { data: { id: "42" } };

      const cb = tracingMiddleware.willResolveField({}, {}, {}, {});
      cb(null, result);

      expect(local.span.log).toHaveBeenCalledWith({
        result: JSON.stringify(result)
      });
    });
    it("finishes the span", () => {
      const cb = tracingMiddleware.willResolveField({}, {}, {}, {});
      cb();
      expect(local.span.finish).toHaveBeenCalled();
    });
  });
});
