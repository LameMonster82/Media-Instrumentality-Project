export function waitATick(): Promise<void> {
    return new Promise<void>(res => {
        //tickResolves.push(res);
        //tickChannel.port2.postMessage("haha");
        setTimeout(res, 0);
    });
}

export function promiseRes<T>() {
    let resolve: (e: T) => void = () => { };
    const promise = new Promise<T>(res => resolve = res);
    return { promise, resolve };
}
