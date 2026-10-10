function waitForInit(session) {
    return new Promise((resolve, reject) => {
        const onInit = (event) => {
            cleanup();
            resolve(event);
        };
        const onExit = (code) => {
            cleanup();
            reject(new Error(`agent exited (code ${code}) before init`));
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            session.off("init", onInit);
            session.off("exit", onExit);
            session.off("error", onError);
        };
        session.on("init", onInit);
        session.on("exit", onExit);
        session.on("error", onError);
    });
}
async function withDiagnostics(pending, phase, stderrLines, observedEvents) {
    try {
        return await pending;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // SDK exit can precede pipe close. Report what was observed without
        // claiming that stderr has drained, retrying, or changing the deadline.
        throw new Error(`${message}\ncc phase: ${phase}\ncc stderr observed before failure:\n${stderrLines.join("").trim() || "<empty>"}\ncc events:\n${JSON.stringify(observedEvents, null, 2)}`, { cause: error });
    }
}
export { waitForInit, withDiagnostics };
