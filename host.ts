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
  - If user wants to create S3 bucket: include "CREATE_S3" and also pass the name if provided by the user
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
                let bucketName = tokens[tokens.length - 1];

                // Helper: extract a likely bucket name from the user's own prompt
                const stopwords = new Set(['create','bucket','buckets','s3','a','an','the','please']);
                const userCandidates = (userPrompt.match(/\b[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])\b/g) || []).filter(w => !stopwords.has(w));
                const bucketPattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
                const userProvidedBucket = userCandidates.find(w => bucketPattern.test(w));

                // Prefer name explicitly provided by the user
                if (userProvidedBucket) {
                    bucketName = userProvidedBucket;
                }

                // Detect if bucket name is missing, not valid, or still a directive
                const isDirective = !bucketName || bucketName === 'CREATE_S3' || bucketName.startsWith('USE_') || bucketName === 'PutObjectInS3' || !bucketPattern.test(bucketName);

                // If the user did not specify a bucket name in their prompt, force prompt even if LLM suggested one
                const userDidNotProvideName = !userProvidedBucket;
                if (isDirective || userDidNotProvideName) {
                    const answer = await this.rl.question('Amazon Q: Please provide a unique S3 bucket name (e.g., my-bucket-1234): ');
                    if (!answer || !answer.trim()) {
                        results.error = 'Bucket name is required to create a bucket.';
                        return results;
                    }
                    bucketName = answer.trim();
                }

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
                    dataToExcel, // Pass object directly, not stringified
                    results.ec2 ? 'EC2 Instances' : 'S3 Buckets'
                );
                const excelContent = excelResult.content as Array<{ type: string; text: string }>;
                try {
                    const excelObj = JSON.parse(excelContent[0].text);
                    results.excelData = excelObj; // { filePath, base64 }
                    results.excel = `Excel file created: ${excelObj.filePath}`;
                } catch {
                    results.excel = excelContent[0].text;
                }
            } else {
                console.log('🔍 DEBUG - Excel condition NOT met');
                console.log('USE_EXCEL found:', llmResponse.includes('USE_EXCEL'));
                console.log('EC2 data exists:', !!results.ec2);
                console.log('S3 data exists:', !!results.s3);
            }
            
            // If instruction includes uploading to S3, handle bucket/key prompts and upload
            if (llmResponse.includes('PutObjectInS3')) {
                // Ensure we have an Excel to upload; if not, try to create from available data
                if (!results.excelData && (results.ec2 || results.s3)) {
                    const dataToExcel = results.ec2 || results.s3;
                    const filename = results.ec2 ? 'ec2-instances' : 's3-buckets';
                    const excelResult = await this.fileClient.writeExcel(
                        filename,
                        dataToExcel,
                        results.ec2 ? 'EC2 Instances' : 'S3 Buckets'
                    );
                    const excelContent = excelResult.content as Array<{ type: string; text: string }>;
                    try {
                        const excelObj = JSON.parse(excelContent[0].text);
                        results.excelData = excelObj;
                        results.excel = `Excel file created: ${excelObj.filePath}`;
                    } catch {}
                }

                if (!results.excelData) {
                    results.error = 'No Excel data available to upload. Please include USE_EXCEL to generate the file first.';
                    return results;
                }

                // Try to detect a bucket name from the user's prompt
                const bucketPattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
                const tokens = (userPrompt.match(/\b[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])\b/g) || []);
                let candidateBucket = tokens.find(t => bucketPattern.test(t));

                // Fetch available buckets
                const s3ListResult = await this.s3Client.getBuckets();
                const s3ListContent = s3ListResult.content as Array<{ type: string; text: string }>;
                let bucketList: string[] = [];
                try {
                    const parsed = JSON.parse(s3ListContent[0].text);
                    bucketList = (parsed.buckets || []).map((b: any) => b.name);
                } catch {}

                // Validate/ask for bucket
                let bucketName = candidateBucket || '';
                while (!bucketName || !bucketList.includes(bucketName)) {
                    const listMsg = bucketList.length ? `Available buckets: ${bucketList.join(', ')}` : 'No buckets found.';
                    const promptMsg = bucketList.length
                        ? `Amazon Q: Enter a valid bucket name from the list above: `
                        : `Amazon Q: No buckets found. Please create one first or enter a valid existing bucket name: `;
                    console.log(listMsg);
                    const answer = await this.rl.question(promptMsg);
                    bucketName = (answer || '').trim();
                    // Re-fetch list in case user created new bucket elsewhere
                    const refreshed = await this.s3Client.getBuckets();
                    try {
                        const parsedRef = JSON.parse((refreshed.content as Array<{ type: string; text: string }>)[0].text);
                        bucketList = (parsedRef.buckets || []).map((b: any) => b.name);
                    } catch {}
                }

                // Determine key name from file path
                const filePath = results.excelData.filePath as string;
                const key = filePath.split('/').pop() || 'output.xlsx';

                console.log(`🗄️ Uploading ${key} to bucket ${bucketName}...`);
                const putResult = await this.s3Client.putObject(bucketName, key, results.excelData.base64);
                const putContent = putResult.content as Array<{ type: string; text: string }>;
                results.s3PutMessage = putContent[0].text;
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
        if (results.s3PutMessage) {
            response += `\n📤 ${results.s3PutMessage}\n`;
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
