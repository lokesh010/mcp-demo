import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as express from 'express';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, CreateBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from 'dotenv';
import z from 'zod';

dotenv.config();

const server = new McpServer({
    name: 'aws-s3-mcp-server',
    version: '1.0.0'
});

server.registerTool('createBucket', {
    title: 'Create S3 Bucket',
    description: 'Create a new S3 bucket',
    inputSchema: {
        bucketName: z.string(),
        region: z.string().optional()
    }
}, async (args: any) => {
    const client = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        }
    });

    try {
        const command = new CreateBucketCommand({
            Bucket: args.bucketName,
            CreateBucketConfiguration: {
                LocationConstraint: args.region || process.env.AWS_REGION
            }
        });
        await client.send(command);
        return { 
            content: [{ 
                type: 'text', 
                text: `Bucket ${args.bucketName} created successfully` 
            }] 
        };
    } catch (error) {
        return { 
            content: [{ 
                type: 'text', 
                text: `Error creating bucket: ${error}` 
            }] 
        };
    }
});

server.registerTool('PutDataInS3', {
    title: 'Put data in S3 bucket',
    description: 'Put data in S3 bucket',
    inputSchema: {
        bucketName: z.string(),
        key: z.string(),
        contentBase64: z.string()
    }
}, async (args: any) => {
    const client = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        }
    });

    try {
        const body = Buffer.from(args.contentBase64, 'base64');
        const command = new PutObjectCommand({
            Bucket: args.bucketName,
            Key: args.key,
            Body: body,
            ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        await client.send(command);
        return { 
            content: [{ 
                type: 'text', 
                text: `Object '${args.key}' uploaded to bucket '${args.bucketName}' successfully.` 
            }] 
        };
    } catch (error) {
        return { 
            content: [{ 
                type: 'text', 
                text: `Error uploading object to bucket: ${error}` 
            }] 
        };
    }
});

server.registerTool(
    'listS3',
    {
        title: 'List AWS S3 Assets',
        description: 'List S3 buckets and their objects'
    },
    async (args: any) => {
        const client = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
            }
        });

        try {
            if (args?.bucket) {
                // List objects in specific bucket
                const command = new ListObjectsV2Command({ Bucket: args.bucket });
                const response = await client.send(command);
                
                const objects = response.Contents?.map(obj => ({
                    key: obj.Key,
                    size: obj.Size,
                    lastModified: obj.LastModified,
                    storageClass: obj.StorageClass
                })) || [];

                return { 
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({
                            bucket: args.bucket,
                            objectCount: objects.length,
                            objects
                        }, null, 2) 
                    }] 
                };
            } else {
                // List all buckets
                const command = new ListBucketsCommand({});
                const response = await client.send(command);
                
                const buckets = response.Buckets?.map(bucket => ({
                    name: bucket.Name,
                    creationDate: bucket.CreationDate
                })) || [];

                return { 
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({
                            bucketCount: buckets.length,
                            buckets
                        }, null, 2) 
                    }] 
                };
            }
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

const port = parseInt(process.env.PORT || '3002');
app.listen(port, () => {
    console.log(`🗄️  S3 MCP Server running on http://localhost:${port}/mcp`);
});
