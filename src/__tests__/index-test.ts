import ApolloOpentracing from "..";
import { addContextHelpers } from "../context";

describe("Apollo Tracing", () => {
  let server, local, tracingMiddleware;
  beforeEach(() => {
    const span = {
      finish: jest.fn(),
      setTag: jest.fn(),
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

      cb();
      expect(server.span.finish).toHaveBeenCalled();
    });

    it("starts and finishes a request spans if there are errors", () => {
      const cb = tracingMiddleware.requestDidStart({ queryString: "query {}" });
      expect(server.startSpan).toHaveBeenCalled();
      expect(local.startSpan).not.toHaveBeenCalled();

      cb(new Error("ups"));
      expect(server.span.finish).toHaveBeenCalled();
    });

    it("predicate gets called with same arguments as the middleware", () => {
      const shouldTraceRequest = jest.fn();
      tracingMiddleware = new ApolloOpentracing({
        server,
        local,
        shouldTraceRequest
      });

      tracingMiddleware.requestDidStart({ queryString: "query {}" });
      expect(shouldTraceRequest).toHaveBeenCalledWith({
        queryString: "query {}"
      });
    });

    it("doesn't start spans when corresponding predicate returns false", () => {
      const shouldTraceRequest = jest.fn().mockReturnValue(false);
      tracingMiddleware = new ApolloOpentracing({
        server,
        local,
        shouldTraceRequest
      });

      tracingMiddleware.requestDidStart({ queryString: "query {}" });
      expect(server.startSpan).not.toHaveBeenCalled();
    });

    it("picks up the tracing headers as parent span", () => {
      server.extract.mockReturnValue({ spanId: 42 });
      tracingMiddleware.requestDidStart({
        queryString: "query {}",
        request: {
          headers: {
            "X-B3-ParentSpanId": "a33c27ae31f3c9e9",
            "X-B3-Sampled": 1,
            "X-B3-SpanId": "42483bbd28a757b4",
            "X-B3-TraceId": "a33c27ae31f3c9e9"
          }
        }
      });

      expect(server.extract).toHaveBeenCalled();
      expect(server.startSpan).toHaveBeenCalledWith(expect.any(String), {
        childOf: { spanId: 42 }
      });
    });
  });

  describe("field resolver", () => {
    it("starts a new local span for the field", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      tracingMiddleware.willResolveField({}, {}, {}, {});
      expect(server.startSpan).not.toHaveBeenCalled();
      expect(local.startSpan).toHaveBeenCalled();
    });

    it("uses the 'fieldname' as the span name if no fieldname can be found", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      tracingMiddleware.willResolveField({}, {}, {}, {});
      expect(local.startSpan).toHaveBeenCalledWith("field", expect.any(Object));
    });

    it("uses the name as the span name if no fieldname can be found", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      tracingMiddleware.willResolveField(
        {},
        {},
        {},
        {
          fieldName: "myField"
        }
      );
      expect(local.startSpan).toHaveBeenCalledWith(
        "myField",
        expect.any(Object)
      );
    });

    it("starts the span as a child span of another field", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      const ctx = {};
      addContextHelpers(ctx);

      ctx.addSpan({ id: "42" }, { path: { key: "previous" } });

      tracingMiddleware.willResolveField({}, {}, ctx, {
        path: { key: "b", prev: { key: "previous" } }
      });
      expect(local.startSpan).toHaveBeenCalledWith("field", {
        childOf: { id: "42" }
      });
    });

    it("starts the span as a child span of the request", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      tracingMiddleware.willResolveField({}, {}, {}, {});
      expect(local.startSpan).toHaveBeenCalledWith("field", {
        childOf: { id: "23" }
      });
    });

    it("does not start a span if there is no request span", () => {
      tracingMiddleware.willResolveField({}, {}, {}, {});
      expect(local.startSpan).not.toHaveBeenCalled();
    });

    it("does not start a span if the predicate returns false", () => {
      const shouldTraceFieldResolver = jest.fn().mockReturnValue(false);
      tracingMiddleware = new ApolloOpentracing({
        server,
        local,
        shouldTraceFieldResolver
      });
      tracingMiddleware.requestSpan = { id: "23" };
      tracingMiddleware.willResolveField(
        { a: true },
        { b: true },
        { c: true },
        { d: true }
      );

      expect(local.startSpan).not.toHaveBeenCalled();
      expect(shouldTraceFieldResolver).toHaveBeenCalledWith(
        { a: true },
        { b: true },
        { c: true },
        { d: true }
      );
    });

    it("adds the spancontext to the context", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      const ctx = {};
      tracingMiddleware.willResolveField({}, {}, ctx, {});
      expect(ctx._spans).toBeDefined();
      expect(ctx.getSpanByPath).toBeInstanceOf(Function);
      expect(ctx.addSpan).toBeInstanceOf(Function);
    });

    it("exposes the span in the info", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      const info = {};
      tracingMiddleware.willResolveField({}, {}, {}, info);
      expect(info.span).toBeDefined();
    });

    it("calls onFieldResolve in willResolveField", () => {
      const onFieldResolve = jest.fn();
      tracingMiddleware = new ApolloOpentracing({
        server,
        local,
        onFieldResolve
      });
      tracingMiddleware.requestSpan = { id: "23" };
      const info = {};
      const context = { headers: "abc" };
      tracingMiddleware.willResolveField({}, {}, context, info);
      expect(onFieldResolve).toHaveBeenCalledWith({}, {}, context, info);
    });

    it("doesn't logs a result and calls on field resolve finish", () => {
      const onFieldResolveFinish = jest.fn();
      tracingMiddleware = new ApolloOpentracing({
        server,
        local,
        onFieldResolveFinish
      });
      tracingMiddleware.requestSpan = { id: "23" };
      const result = { data: { id: "42" } };

      const cb = tracingMiddleware.willResolveField({}, {}, {}, {});
      cb(null, result);

      expect(onFieldResolveFinish).toHaveBeenCalledWith(
        null,
        result,
        local.span
      );
      expect(local.span.log).not.toHaveBeenCalledWith({
        result: JSON.stringify(result)
      });
    });

    it("finishes the span", () => {
      tracingMiddleware.requestSpan = { id: "23" };
      const cb = tracingMiddleware.willResolveField({}, {}, {}, {});
      cb();
      expect(local.span.finish).toHaveBeenCalled();
    });
  });
});
