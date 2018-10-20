export interface MockSpan {
  id: number;
  parentId?: number;
  name: string;
  options?: any;
  logs: any[];
  finished: boolean;
}

export interface MockSpanTree extends MockSpan {
  children: MockSpanTree[];
}
