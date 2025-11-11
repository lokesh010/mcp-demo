import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class EC2Client {
    private client: Client;
    private transport: StreamableHTTPClientTransport;

    constructor() {
        const serverUrl = new URL("http://localhost:3001/mcp");
        this.transport = new StreamableHTTPClientTransport(serverUrl);
        this.client = new Client({
            name: "ec2-client",
            version: "1.0.0",
        });
    }

    async connect() {
        await this.client.connect(this.transport);
    }

    async listTools() {
        return await this.client.listTools();
    }

    async getInstances(zone?: string) {
        const result = await this.client.callTool({ 
            name: 'listEC2', 
            arguments: zone ? { zone } : {} 
        });
        return result;
    }

    async disconnect() {
        await this.transport.close();
    }
}
