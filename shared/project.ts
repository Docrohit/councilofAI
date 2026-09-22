export type ProjectAction =
  | { action: "tree" | "diff" }
  | { action: "read"; path: string; offset?: number }
  | { action: "search"; query: string }
  | { action: "write"; path: string; content: string; sha: string | null }
  | {
      action: "patch";
      path: string;
      search: string;
      replacement: string;
      sha: string;
    }
  | { action: "delete"; path: string; sha: string }
  | { action: "move"; path: string; destination: string; sha: string }
  | { action: "exec"; command: string };
export interface ProjectRuntime {
  directory: string;
  instructions(): Promise<string>;
  execute(action: ProjectAction, signal: AbortSignal): Promise<any>;
}
export interface ProjectPermission {
  kind: "write" | "exec";
  title: string;
  detail: string;
}
