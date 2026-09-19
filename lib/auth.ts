export function isSecureMode(): boolean {
    return !!process.env.OPENCODE_SERVER_PASSWORD
}
