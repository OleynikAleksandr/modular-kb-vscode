import express from 'express';
import { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import { Readable } from 'stream';
import { fetch, Headers } from 'undici';
import * as fs from 'fs';
import * as path from 'path';
const { createParser } = require('eventsource-parser');
import { OrchestratorAdapter } from './orchestrator-adapter';

const orchestratorAdapter = new OrchestratorAdapter();

const app = express();
app.use(express.json());

let PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7001;

process.argv.forEach((arg, index) => {
    if (arg === '--port' && process.argv.length > index + 1) {
        PORT = parseInt(process.argv[index + 1], 10);
    }
});

app.use((req: Request, res: Response, next: NextFunction) => {
    const message = `${req.method} ${req.path}`;
    console.log(`${new Date().toISOString()} - ${message}`);
    next();
});

app.get('/ping', (req: Request, res: Response) => {
    console.log('Received ping request');
    res.status(200).json({ status: 'ok' });
});

app.post('/v1/chat/completions', async (req: Request, res: Response) => {
    try {
        console.log('Received chat completions request');
        
        const requestBody = req.body;
        const messages = requestBody.messages || [];
        const meta = {
            model: requestBody.model,
            headers: req.headers,
            ip: req.ip,
            path: req.path,
            method: req.method
        };
        
        console.log(`Processing request with model: ${meta.model}`);
        
        const processedMessages = await orchestratorAdapter.processPrompt(messages, meta);
        
        const processedRequestBody = {
            ...requestBody,
            messages: processedMessages
        };
        
        const isStreaming = requestBody.stream === true;
        console.log(`Request is streaming: ${isStreaming}`);
        
        if (isStreaming) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            console.log('Sending streaming request to OpenAI API');
            const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                    'OpenAI-Organization': req.headers['openai-organization'] || ''
                },
                body: JSON.stringify(processedRequestBody)
            });
            
            if (!openaiResponse.ok) {
                const errorText = await openaiResponse.text();
                console.error(`Error from OpenAI API: ${errorText}`);
                res.status(openaiResponse.status).send(errorText);
                return;
            }
            
            const reader = openaiResponse.body;
            if (!reader) {
                console.error('No response body from OpenAI API');
                res.status(500).send('Internal Server Error: No response body');
                return;
            }
            
            console.log('Setting up SSE parser');
            const parser = createParser((event: any) => {
                if (event.type === 'event' && event.data) {
                    console.log('Received SSE event');
                    orchestratorAdapter.processResponse(event.data, meta)
                        .then(processedData => {
                            res.write(`data: ${processedData}\n\n`);
                            
                            if (processedData === '[DONE]') {
                                console.log('Stream completed');
                                res.end();
                            }
                        })
                        .catch(error => {
                            console.error(`Error processing response: ${error}`);
                            res.write(`data: ${event.data}\n\n`);
                        });
                }
            });
            
            const stream = Readable.fromWeb(reader as any);
            
            stream.on('data', (chunk) => {
                parser.feed(chunk.toString());
            });
            
            stream.on('error', (err) => {
                console.error(`Stream error: ${err}`);
                res.status(500).send('Internal Server Error');
            });
            
            stream.on('end', () => {
                console.log('Stream ended');
                if (!res.writableEnded) {
                    res.end();
                }
            });
            
            req.on('close', () => {
                console.log('Request closed, destroying stream');
                stream.destroy();
            });
        } else {
            console.log('Sending non-streaming request to OpenAI API');
            const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                    'OpenAI-Organization': req.headers['openai-organization'] || ''
                },
                body: JSON.stringify(processedRequestBody)
            });
            
            if (!openaiResponse.ok) {
                const errorText = await openaiResponse.text();
                console.error(`Error from OpenAI API: ${errorText}`);
                res.status(openaiResponse.status).send(errorText);
                return;
            }
            
            console.log('Received response from OpenAI API');
            const openaiResponseData = await openaiResponse.json();
            
            const processedResponseData = await orchestratorAdapter.processResponse(openaiResponseData, meta);
            
            console.log('Sending response to client');
            res.json(processedResponseData);
        }
    } catch (error) {
        console.error(`Request processing error: ${error}`);
        res.status(500).send('Internal Server Error');
    }
});

app.use('*', async (req: Request, res: Response) => {
    try {
        const targetUrl = `https://api.openai.com${req.originalUrl}`;
        console.log(`Proxying request to: ${targetUrl}`);
        
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
            if (value && key !== 'host' && key !== 'connection') {
                headers.set(key, Array.isArray(value) ? value.join(', ') : value.toString());
            }
        }
        
        const options: any = {
            method: req.method,
            headers
        };
        
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            console.log(`Adding body to ${req.method} request`);
            options.body = JSON.stringify(req.body);
        }
        
        console.log(`Sending ${req.method} request to OpenAI API`);
        const openaiResponse = await fetch(targetUrl, options);
        
        console.log(`Received response with status: ${openaiResponse.status}`);
        res.status(openaiResponse.status);
        for (const [key, value] of openaiResponse.headers.entries()) {
            res.setHeader(key, value);
        }
        
        const responseBody = await openaiResponse.arrayBuffer();
        console.log(`Sending response to client (${responseBody.byteLength} bytes)`);
        res.send(Buffer.from(responseBody));
    } catch (error) {
        console.error(`Error proxying request: ${error}`);
        res.status(500).send('Internal Server Error');
    }
});

const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`Proxy server for Copilot Chat started successfully on port ${PORT}`);
    console.log(`Logs will be available in VS Code Output Panel and in ~/.orchestrator/logs/`);
    console.log(`Make sure GH_COPILOT_OVERRIDE_PROXY_URL=http://127.0.0.1:${PORT} is set`);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM signal, shutting down proxy gracefully');
    server.close(() => {
        console.log('Proxy server closed successfully');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT signal, shutting down proxy gracefully');
    server.close(() => {
        console.log('Proxy server closed successfully');
        process.exit(0);
    });
});

server.timeout = 120000;
