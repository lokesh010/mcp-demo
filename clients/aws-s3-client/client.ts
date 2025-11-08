import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class S3Client {
    private client: Client;
    private transport: StreamableHTTPClientTransport;

    constructor() {
        const serverUrl = new URL("http://localhost:3002/mcp");
        this.transport = new StreamableHTTPClientTransport(serverUrl);
        this.client = new Client({
            name: "s3-client",
            version: "1.0.0",
        });
    }

    async connect() {
        await this.client.connect(this.transport);
    }

    async listTools() {
        return await this.client.listTools();
    }

    async getBuckets(bucket?: string) {
        const result = await this.client.callTool({ 
            name: 'listS3', 
            arguments: bucket ? { bucket } : {} 
        });
        return result;
    }

    async disconnect() {
        await this.transport.close();
    }
}
