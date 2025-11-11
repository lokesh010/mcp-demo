import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as express from 'express';
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import * as dotenv from 'dotenv';

dotenv.config();

const server = new McpServer({
    name: 'aws-ec2-mcp-server',
    version: '1.0.0'
});

server.registerTool(
    'listEC2',
    {
        title: 'List AWS EC2 Instances',
        description: 'List EC2 instances in specified AWS zone'
    },
    async (args: any) => {
        const zone = args?.zone || process.env.AWS_REGION || 'ap-southeast-1';

        const client = new EC2Client({
            region: zone,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
            }
        });

        try {
            const command = new DescribeInstancesCommand({});
            const response = await client.send(command);
            
            const instances = response.Reservations?.flatMap(r => 
                r.Instances?.map(i => ({
                    id: i.InstanceId,
                    name: i.Tags?.find(t => t.Key === 'Name')?.Value || 'No Name',
                    state: i.State?.Name,
                    type: i.InstanceType,
                    zone: i.Placement?.AvailabilityZone,
                    publicIp: i.PublicIpAddress,
                    privateIp: i.PrivateIpAddress
                })) || []
            ) || [];

            return { 
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({
                        zone,
                        count: instances.length,
                        instances
                    }, null, 2) 
                }] 
            };
        } catch (error) {
            return { 
                content: [{ 
                    type: 'text', 
                    text: `Error: ${error}` 
                }] 
            };
        }
    }
);

const app = express.default();
app.use(express.json());

app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });

    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || '3001');
app.listen(port, () => {
    console.log(`🗄️  S3 MCP Server running on http://localhost:${port}/mcp`);
});

