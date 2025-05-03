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
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

app.get('/ping', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
});

app.post('/v1/chat/completions', async (req: Request, res: Response) => {
    try {
        const requestBody = req.body;
        const messages = requestBody.messages || [];
        const meta = {
            model: requestBody.model,
            headers: req.headers,
            ip: req.ip,
            path: req.path,
            method: req.method
        };
        
        const processedMessages = await orchestratorAdapter.processPrompt(messages, meta);
        
        const processedRequestBody = {
            ...requestBody,
            messages: processedMessages
        };
        
        const isStreaming = requestBody.stream === true;
        
        if (isStreaming) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
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
                console.error('Ошибка при запросе к OpenAI API:', errorText);
                res.status(openaiResponse.status).send(errorText);
                return;
            }
            
            const reader = openaiResponse.body;
            if (!reader) {
                res.status(500).send('Internal Server Error: No response body');
                return;
            }
            
            const parser = createParser((event: any) => {
                if (event.type === 'event' && event.data) {
                    orchestratorAdapter.processResponse(event.data, meta)
                        .then(processedData => {
                            res.write(`data: ${processedData}\n\n`);
                            
                            if (processedData === '[DONE]') {
                                res.end();
                            }
                        })
                        .catch(error => {
                            console.error('Ошибка при обработке ответа:', error);
                            res.write(`data: ${event.data}\n\n`);
                        });
                }
            });
            
            const stream = Readable.fromWeb(reader as any);
            
            stream.on('data', (chunk) => {
                parser.feed(chunk.toString());
            });
            
            stream.on('error', (err) => {
                console.error('Ошибка при чтении потока:', err);
                res.status(500).send('Internal Server Error');
            });
            
            stream.on('end', () => {
                if (!res.writableEnded) {
                    res.end();
                }
            });
            
            req.on('close', () => {
                stream.destroy();
            });
        } else {
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
                console.error('Ошибка при запросе к OpenAI API:', errorText);
                res.status(openaiResponse.status).send(errorText);
                return;
            }
            
            const openaiResponseData = await openaiResponse.json();
            
            const processedResponseData = await orchestratorAdapter.processResponse(openaiResponseData, meta);
            
            res.json(processedResponseData);
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.use('*', async (req: Request, res: Response) => {
    try {
        const targetUrl = `https://api.openai.com${req.originalUrl}`;
        
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
            options.body = JSON.stringify(req.body);
        }
        
        const openaiResponse = await fetch(targetUrl, options);
        
        res.status(openaiResponse.status);
        for (const [key, value] of openaiResponse.headers.entries()) {
            res.setHeader(key, value);
        }
        
        const responseBody = await openaiResponse.arrayBuffer();
        res.send(Buffer.from(responseBody));
    } catch (error) {
        console.error('Ошибка при проксировании запроса:', error);
        res.status(500).send('Internal Server Error');
    }
});

const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`Proxy server is running on port ${PORT}`);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

server.timeout = 120000; // 120 секунд
