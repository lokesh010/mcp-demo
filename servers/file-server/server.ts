import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as express from 'express';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import z from 'zod';

dotenv.config();

const server = new McpServer({
    name: 'file-mcp-server',
    version: '1.0.0'
});

server.registerTool(
    'writeExcel',
    {
        title: 'Write Excel File',
        description: 'Create Excel file with provided data',
        inputSchema: {
            filename: z.string(),
            data: z.any(),
            sheetName: z.string()
        }
    },
    async (args: any) => {
        console.log('🔍 DEBUG - Excel writeExcel called with args:',args);
        try {
            const { filename, data, sheetName = 'Sheet1' } = args;
            console.log('🔍 DEBUG - Extracted:', { filename, data, sheetName });
            console.log('🔍 DEBUG - Data type:', typeof data);
            
            const outputDir = path.join(__dirname, '../../output');
            
            // Ensure output directory exists
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(sheetName);

            // Parse data
            let parsedData;
            try {
                parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log('🔍 DEBUG - Parsed data:', parsedData);
                console.log('🔍 DEBUG - Has instances?', !!parsedData.instances);
                if (parsedData.instances) {
                    console.log('🔍 DEBUG - Instances:', parsedData.instances);
                }
            } catch (error) {
                return { 
                    content: [{ 
                        type: 'text', 
                        text: `Error parsing data: ${error}. Data received: ${args}`
                    }] 
                };
            }
            
            if (parsedData.instances && Array.isArray(parsedData.instances)) {
                // EC2 instances format
                worksheet.columns = [
                    { header: 'Instance ID', key: 'id', width: 20 },
                    { header: 'Name', key: 'name', width: 15 },
                    { header: 'State', key: 'state', width: 10 },
                    { header: 'Type', key: 'type', width: 12 },
                    { header: 'Zone', key: 'zone', width: 15 },
                    { header: 'Public IP', key: 'publicIp', width: 15 },
                    { header: 'Private IP', key: 'privateIp', width: 15 }
                ];
                
                parsedData.instances.forEach((instance: any) => {
                    worksheet.addRow(instance);
                });
            } else if (parsedData.buckets && Array.isArray(parsedData.buckets)) {
                // S3 buckets format
                worksheet.columns = [
                    { header: 'Bucket Name', key: 'name', width: 30 },
                    { header: 'Creation Date', key: 'creationDate', width: 20 }
                ];
                
                parsedData.buckets.forEach((bucket: any) => {
                    worksheet.addRow(bucket);
                });
            } else {
                // Generic data format
                const keys = Object.keys(parsedData);
                worksheet.columns = keys.map(key => ({ header: key, key, width: 15 }));
                worksheet.addRow(parsedData);
            }

            const filePath = path.join(outputDir, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
            await workbook.xlsx.writeFile(filePath);

            return { 
                content: [{ 
                    type: 'text', 
                    text: `Excel file created successfully: ${filePath}` 
                }] 
            };
        } catch (error) {
            return { 
                content: [{ 
                    type: 'text', 
                    text: `Error creating Excel file: ${error}` 
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

const port = parseInt(process.env.PORT || '3003');
app.listen(port, () => {
    console.log(`📊 File MCP Server running on http://localhost:${port}/mcp`);
});
