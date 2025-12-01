declare const api: {
    ukey: {
        detect: () => Promise<any>;
        verifyPIN: (pin: string) => Promise<any>;
        sign: (data: string) => Promise<any>;
        verifySignature: (data: string, signature: string) => Promise<any>;
    };
    knowledge: {
        getItems: (limit?: number, offset?: number) => Promise<any>;
        addItem: (item: any) => Promise<any>;
        updateItem: (id: string, updates: any) => Promise<any>;
        deleteItem: (id: string) => Promise<any>;
        searchItems: (query: string) => Promise<any>;
        getItemById: (id: string) => Promise<any>;
    };
    git: {
        sync: () => Promise<any>;
        commit: (message: string) => Promise<any>;
        getStatus: () => Promise<any>;
    };
    llm: {
        query: (prompt: string, context?: string[]) => Promise<any>;
        queryStream: (prompt: string, context?: string[], onChunk?: (chunk: string) => void) => Promise<any>;
        checkStatus: () => Promise<any>;
    };
    system: {
        getVersion: () => Promise<any>;
        minimize: () => Promise<any>;
        maximize: () => Promise<any>;
        close: () => Promise<any>;
    };
};
export type ElectronAPI = typeof api;
export {};
//# sourceMappingURL=index.d.ts.map