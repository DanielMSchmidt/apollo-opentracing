import { Span } from "opentracing";
import { GraphQLResolveInfo } from "graphql";

import { SpanContext } from "./index";
import { buildPath } from "./util";

export default class Context implements SpanContext {
  private spans: Map<string, Span> = new Map<string, Span>();

  public getSpan(info: GraphQLResolveInfo): Span | undefined {
    return this.spans.get(buildPath(info.path));
  }

  public addSpan(span: Span, info: GraphQLResolveInfo): void {
    this.spans.set(buildPath(info.path), span);
  }
}
