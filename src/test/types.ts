export interface MockSpan {
  id: number;
  parentId?: number;
  name: string;
  options?: any;
  logs: any[];
  tags: any[];
  finished: boolean;
}

export interface MockSpanTree extends MockSpan {
  children: MockSpanTree[];
}
