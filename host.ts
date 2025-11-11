import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EC2Client } from './clients/aws-ec2-client/client';
import { S3Client } from './clients/aws-s3-client/client';
import { FileClient } from './clients/file-client/client';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import dotenv from 'dotenv';

dotenv.config();

class MCPDemoHost {
    private bedrock: BedrockRuntimeClient;
    private ec2Client: EC2Client;
    private s3Client: S3Client;
    private fileClient: FileClient;
    private rl: readline.Interface;

    constructor() {
        this.bedrock = new BedrockRuntimeClient({
            region: 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
            }
        });
        
        this.ec2Client = new EC2Client();
        this.s3Client = new S3Client();
        this.fileClient = new FileClient();
        this.rl = readline.createInterface({ input, output });
    }

    async connectToMCP() {
        try {
            await this.ec2Client.connect();
            await this.s3Client.connect();
            await this.fileClient.connect();
            
            console.log('✅ Connected to all MCP servers');
            return true;
        } catch (error) {
            console.log('❌ MCP connection failed:', error);
            return false;
        }
    }

    async getCapabilities() {
        try {
            const ec2Tools = await this.ec2Client.listTools();
            const s3Tools = await this.s3Client.listTools();
            const fileTools = await this.fileClient.listTools();
            
            return {
                ec2: ec2Tools.tools.map(t => `${t.name}: ${t.description}`),
                s3: s3Tools.tools.map(t => `${t.name}: ${t.description}`),
                file: fileTools.tools.map(t => `${t.name}: ${t.description}`)
            };
        } catch (error) {
            return { ec2: [], s3: [], file: [] };
        }
    }

    async askBedrock(prompt: string, capabilities: any) {
        try {
            const systemPrompt = `You are Amazon Q, an AWS AI assistant with access to these MCP tools:

EC2 Tools: ${capabilities.ec2.join(', ')}
S3 Tools: ${capabilities.s3.join(', ')}
File Tools: ${capabilities.file.join(', ')}

User request: "${prompt}".

Your task:
- When the request requires using any of the above MCP tools, respond with ONLY the space-separated tool names that are needed (no explanations). Use these conventions:
  - If user wants EC2 data: include "USE_EC2"
  - If user wants S3 data: include "USE_S3"
  - If user wants to create S3 bucket: include "CREATE_S3" and also pass the name-random_string mentioned by user with required format output:test-hbadh87hu
  - If user wants to put object/data to bucket: include "PutObjectInS3" and ask for the file name and bucket name if missing (these are required)
  - If user wants Excel/file output: include "USE_EXCEL"
  - For "list ec2 and save to excel" respond: "USE_EC2 USE_EXCEL"
  - For "write in excel" without specifying data, respond: "USE_EC2 USE_EXCEL"
- Otherwise, if the request is unrelated to these tools or can be answered directly, provide a concise, helpful answer to the user's question in natural language. Do not include any tool names in this case.`;

            const command = new InvokeModelCommand({
                modelId: "us.anthropic.claude-3-haiku-20240307-v1:0",
                body: JSON.stringify({
                    anthropic_version: "bedrock-2023-05-31",
                    max_tokens: 300,
                    temperature: 0.3,
                    messages: [{ role: "user", content: systemPrompt }]
                }),
                contentType: "application/json",
                accept: "application/json"
            });

            const response = await this.bedrock.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            console.log(responseBody.content[0].text, "response")
            return responseBody.content[0].text;
        } catch (error) {
            return `Bedrock error: ${error}`;
        }
    }

    async executeTools(llmResponse: string, userPrompt: string) {
        let results: any = {};
        
        try {
            if (llmResponse.includes('USE_EC2')) {
                console.log('🔍 Executing EC2 tool...');
                
                const ec2Result = await this.ec2Client.getInstances('ap-southeast-1');
                const content = ec2Result.content as Array<{ type: string; text: string }>;
                results.ec2 = JSON.parse(content[0].text);
            }
            
            if (llmResponse.includes('USE_S3')) {
                console.log('🗄️ Executing S3 tool...');
                const s3Result = await this.s3Client.getBuckets();
                const content = s3Result.content as Array<{ type: string; text: string }>;
                results.s3 = JSON.parse(content[0].text);
            }

            if (llmResponse.includes('CREATE_S3')) {
                console.log('🗄️ Executing S3 tool create bucket...');                
                const tokens = llmResponse.trim().split(/\s+/);
                const bucketName = tokens[tokens.length - 1];
                
                const s3Result = await this.s3Client.createBucket(bucketName, 'ap-southeast-1');
                const content = s3Result.content as Array<{ type: string; text: string }>;
                results.createBucketMessage = content[0].text;
            }
            
            if (llmResponse.includes('USE_EXCEL') && (results.ec2 || results.s3)) {
                console.log('📊 Creating Excel file...');
                console.log('🔍 DEBUG - Excel condition met');
                const dataToExcel = results.ec2 || results.s3;
                const filename = results.ec2 ? 'ec2-instances' : 's3-buckets';
                
                // console.log('🔍 DEBUG - Data to Excel:', dataToExcel);
                
                const excelResult = await this.fileClient.writeExcel(
                    filename, 
                    dataToExcel, // Pass object directly, not stringi`fied
                    results.ec2 ? 'EC2 Instances' : 'S3 Buckets'
                );
                const excelContent = excelResult.content as Array<{ type: string; text: string }>;
                results.excel = excelContent[0].text;
            } else {
                console.log('🔍 DEBUG - Excel condition NOT met');
                console.log('USE_EXCEL found:', llmResponse.includes('USE_EXCEL'));
                console.log('EC2 data exists:', !!results.ec2);
                console.log('S3 data exists:', !!results.s3);
            }
            
            return results;
        } catch (error) {
            console.log(error)
            return { error: `Tool execution failed: ${error}` };
        }
    }

    formatResponse(results: any, llmResponse: string) {
        let response = '';
        
        if (results.ec2) {
            response += `\n🖥️ EC2 Instances in ap-southeast-1:\n`;
            results.ec2.instances.forEach((instance: any) => {
                response += `- ${instance.name} (${instance.id}): ${instance.state} - ${instance.type}\n`;
            });
        }
        
        if (results.s3) {
            response += `\n🗄️ S3 Buckets (${results.s3.bucketCount}):\n`;
            results.s3.buckets.forEach((bucket: any) => {
                response += `- ${bucket.name} (created: ${bucket.creationDate})\n`;
            });
        }
        
        if (results.excel) {
            response += `\n📊 ${results.excel}\n`;
        }
        
        if (results.createBucketMessage) {
            response += `\n✅ ${results.createBucketMessage}\n`;
        }
        
        if (results.error) {
            response += `\n❌ ${results.error}\n`;
        }
        
        if (!results.ec2 && !results.s3 && !results.excel && !results.createBucketMessage && !results.error) {
            response = llmResponse;
        }
        
        return response;
    }

    async processRequest(userPrompt: string) {
        const capabilities = await this.getCapabilities();
        const llmResponse = await this.askBedrock(userPrompt, capabilities);
        const results = await this.executeTools(llmResponse, userPrompt);
        console.log({capabilities, llmResponse, results, userPrompt});
        return this.formatResponse(results, llmResponse);
    }

    async startChat() {
        console.log('\n💬 Amazon Q MCP Demo ready! Type your questions or "quit" to exit.\n');
        console.log('Try: "Show me EC2 instances", "List S3 buckets", "Show EC2 and save to Excel"\n');
        
        while (true) {
            try {
                const userInput = await this.rl.question('You: ');
                
                if (userInput.toLowerCase().trim() === 'quit') {
                    console.log('👋 Goodbye!');
                    break;
                }
                
                if (userInput.trim()) {
                    console.log('\n🧠 Amazon Q: Processing...');
                    const response = await this.processRequest(userInput.trim());
                    console.log(`\nAmazon Q: ${response}\n`);
                }
                
            } catch (error) {
                console.error('Error:', error);
                break;
            }
        }
    }

    async cleanup() {
        await this.ec2Client.disconnect();
        await this.s3Client.disconnect();
        await this.fileClient.disconnect();
        this.rl.close();
    }
}

async function main() {
    const host = new MCPDemoHost();
    
    try {
        console.log('🔗 Connecting to MCP servers...');
        await host.connectToMCP();
        await host.startChat();
    } catch (error) {
        console.error('❌ Host error:', error);
    } finally {
        await host.cleanup();
    }
}

if (require.main === module) {
    main();
}
