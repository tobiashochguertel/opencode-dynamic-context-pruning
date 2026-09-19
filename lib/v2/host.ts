/**
 * Minimal host interface for the pieces of the V1 `PluginInput` that DCP
 * actually uses: the working directory and a way to surface user-facing
 * warnings (V1 used `ctx.client.tui.showToast`; V2 server-side plugins have
 * no TUI bridge, so warnings go to the log instead).
 */
export interface PluginHost {
    /** Project working directory (V1 `ctx.directory`; V2 `ctx.location.directory`). */
    directory: string
    /** User-visible notification (title + body). */
    notify: (title: string, message: string) => void
}
