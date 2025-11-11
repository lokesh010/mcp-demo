import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class FileClient {
    private client: Client;
    private transport: StreamableHTTPClientTransport;

    constructor() {
        const serverUrl = new URL("http://localhost:3003/mcp");
        this.transport = new StreamableHTTPClientTransport(serverUrl);
        this.client = new Client({
            name: "file-client",
            version: "1.0.0",
        });
    }

    async connect() {
        await this.client.connect(this.transport);
    }

    async listTools() {
        return await this.client.listTools();
    }

    async writeExcel(filename: string, data: string, sheetName?: string) {
        const result = await this.client.callTool({ 
            name: 'writeExcel', 
            arguments: { filename, data, sheetName } 
        });
        return result;
    }

    async disconnect() {
        await this.transport.close();
    }
}
