package com.xenonlabs.app;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Minimal OpenAI-compatible HTTP server.
 *
 * Listens on a TCP port, accepts one request at a time (the underlying
 * llama.cpp context is single-threaded), and streams responses using
 * the Server-Sent Events format that OpenAI clients expect.
 *
 * Endpoints:
 *   GET  /health                 (public, no auth)
 *   GET  /v1/models              (auth)
 *   POST /v1/chat/completions    (auth)
 */
public class LocalServer {

    public static final String TAG = "XenonServer";

    public interface Generator {
        boolean generate(String prompt,
                         int maxTokens,
                         float temperature,
                         float topP,
                         int topK,
                         TokenSink onToken);
        String modelName();
    }

    public interface TokenSink {
        /** Return false to request cancellation. */
        boolean onToken(String piece);
    }

    private final int port;
    private final String apiKey;
    private final Generator generator;
    private final AtomicBoolean running = new AtomicBoolean(false);

    private ServerSocket serverSocket;
    private Thread acceptThread;

    public LocalServer(int port, String apiKey, Generator generator) {
        this.port = port;
        this.apiKey = apiKey;
        this.generator = generator;
    }

    public boolean isRunning() { return running.get(); }
    public int getPort() { return port; }

    public boolean start() {
        if (running.get()) return true;
        try {
            serverSocket = new ServerSocket(port);
            serverSocket.setReuseAddress(true);
            running.set(true);
        } catch (IOException e) {
            Log.e(TAG, "bind failed on port " + port, e);
            return false;
        }
        acceptThread = new Thread(this::acceptLoop, "xenon-http-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        Log.i(TAG, "listening on 0.0.0.0:" + port);
        return true;
    }

    public void stop() {
        running.set(false);
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
        serverSocket = null;
        if (acceptThread != null) {
            try { acceptThread.join(1000); } catch (InterruptedException ignored) {}
            acceptThread = null;
        }
    }

    public static String localIpv4() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface iface : Collections.list(ifaces)) {
                if (!iface.isUp() || iface.isLoopback()) continue;
                String name = iface.getName();
                if (name == null) continue;
                if (!name.startsWith("wlan") && !name.startsWith("eth")) continue;
                for (InetAddress addr : Collections.list(iface.getInetAddresses())) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (SocketException ignored) {}
        return null;
    }

    /* ============================================================ */
    /* Accept loop                                                  */
    /* ============================================================ */

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket client = serverSocket.accept();
                Thread t = new Thread(() -> handleClient(client), "xenon-http-req");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running.get()) Log.w(TAG, "accept failed", e);
            }
        }
    }

    private void handleClient(Socket sock) {
        try {
            sock.setSoTimeout(180_000);
            InputStream in = sock.getInputStream();
            OutputStream out = new BufferedOutputStream(sock.getOutputStream());

            Request req = readRequest(in);
            if (req == null) { close(sock); return; }

            /* --- route dispatch --- */
            /* /health is public; everything under /v1/* needs the key. */
            String path = req.path;
            boolean isPublic = req.method.equals("GET") && path.equals("/health");

            if (!isPublic && apiKey != null && !apiKey.isEmpty()) {
                String auth = req.headers.get("authorization");
                if (auth == null || !auth.equalsIgnoreCase("Bearer " + apiKey)) {
                    sendError(out, 401, "invalid api key");
                    close(sock);
                    return;
                }
            }

            if (isPublic) {
                sendJson(out, 200, "{\"status\":\"ok\"}");
            } else if (req.method.equals("GET") && path.equals("/v1/models")) {
                handleModels(out);
            } else if (req.method.equals("POST") && path.equals("/v1/chat/completions")) {
                handleChat(req, out);
            } else {
                sendError(out, 404, "not found: " + req.method + " " + path);
            }

            close(sock);
        } catch (IOException e) {
            Log.w(TAG, "client handler failed", e);
            close(sock);
        }
    }

    private static void close(Socket s) {
        try { s.close(); } catch (IOException ignored) {}
    }

    /* ============================================================ */
    /* HTTP parsing                                                 */
    /* ============================================================ */

    private static final class Request {
        String method;
        String path;
        String version;
        Map<String, String> headers = new HashMap<>();
        byte[] body;
    }

    private Request readRequest(InputStream in) throws IOException {
        ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
        int state = 0;
        int b;
        while ((b = in.read()) != -1) {
            headerBytes.write(b);
            if ((state == 0 || state == 2) && b == '\r') state++;
            else if ((state == 1 || state == 3) && b == '\n') state++;
            else state = 0;
            if (state == 4) break;
            if (headerBytes.size() > 65536) throw new IOException("headers too large");
        }
        if (state != 4) return null;

        String headerText = headerBytes.toString("ISO-8859-1");
        String[] lines = headerText.split("\r\n");
        if (lines.length == 0) return null;

        Request req = new Request();
        String[] parts = lines[0].split(" ");
        if (parts.length < 3) return null;
        req.method  = parts[0].toUpperCase(Locale.ROOT);
        req.path    = parts[1];
        req.version = parts[2];

        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.isEmpty()) continue;
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String k = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String v = line.substring(colon + 1).trim();
            req.headers.put(k, v);
        }

        String cl = req.headers.get("content-length");
        int contentLength = 0;
        if (cl != null) {
            try { contentLength = Integer.parseInt(cl); } catch (NumberFormatException ignored) {}
        }
        if (contentLength > 0) {
            if (contentLength > 16 * 1024 * 1024) throw new IOException("body too large");
            req.body = new byte[contentLength];
            int off = 0;
            while (off < contentLength) {
                int n = in.read(req.body, off, contentLength - off);
                if (n < 0) break;
                off += n;
            }
        } else {
            req.body = new byte[0];
        }
        return req;
    }

    /* ============================================================ */
    /* Routes                                                       */
    /* ============================================================ */

    private void handleModels(OutputStream out) throws IOException {
        try {
            JSONObject model = new JSONObject();
            model.put("id", generator.modelName());
            model.put("object", "model");
            model.put("created", System.currentTimeMillis() / 1000L);
            model.put("owned_by", "xenonlabs");

            JSONArray arr = new JSONArray();
            arr.put(model);

            JSONObject root = new JSONObject();
            root.put("object", "list");
            root.put("data", arr);

            sendJson(out, 200, root.toString());
        } catch (Exception e) {
            sendError(out, 500, "json: " + e.getMessage());
        }
    }

    private void handleChat(Request req, OutputStream out) throws IOException {
        JSONObject body;
        try {
            body = new JSONObject(new String(req.body, StandardCharsets.UTF_8));
        } catch (Exception e) {
            sendError(out, 400, "invalid json: " + e.getMessage());
            return;
        }

        JSONArray messages = body.optJSONArray("messages");
        if (messages == null || messages.length() == 0) {
            sendError(out, 400, "messages[] required");
            return;
        }

        String systemPrompt = null;
        StringBuilder dialog = new StringBuilder();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject m = messages.optJSONObject(i);
            if (m == null) continue;
            String role = m.optString("role", "user");
            String content = m.optString("content", "");
            if ("system".equals(role)) {
                systemPrompt = content;
            } else {
                dialog.append(role).append(": ").append(content).append('\n');
            }
        }
        dialog.append("assistant:");

        StringBuilder prompt = new StringBuilder();
        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            prompt.append("System: ").append(systemPrompt).append('\n');
        }
        prompt.append(dialog);

        int maxTokens = body.optInt("max_tokens", 256);
        if (maxTokens <= 0 || maxTokens > 4096) maxTokens = 256;
        double temp = body.optDouble("temperature", 0.7);
        double topP = body.optDouble("top_p", 0.95);
        int topK = body.optInt("top_k", 40);
        boolean stream = body.optBoolean("stream", false);

        String id = "chatcmpl-" + Long.toHexString(System.currentTimeMillis());
        String modelName = generator.modelName();

        if (!stream) {
            StringBuilder acc = new StringBuilder();
            boolean ok = generator.generate(prompt.toString(), maxTokens,
                    (float) temp, (float) topP, topK,
                    piece -> { acc.append(piece); return true; });
            if (!ok) { sendError(out, 500, "generation failed"); return; }

            try {
                JSONObject msg = new JSONObject();
                msg.put("role", "assistant");
                msg.put("content", acc.toString());

                JSONObject choice = new JSONObject();
                choice.put("index", 0);
                choice.put("message", msg);
                choice.put("finish_reason", "stop");

                JSONArray choices = new JSONArray();
                choices.put(choice);

                JSONObject root = new JSONObject();
                root.put("id", id);
                root.put("object", "chat.completion");
                root.put("created", System.currentTimeMillis() / 1000L);
                root.put("model", modelName);
                root.put("choices", choices);

                sendJson(out, 200, root.toString());
            } catch (Exception e) {
                sendError(out, 500, "json: " + e.getMessage());
            }
            return;
        }

        /* --- streaming (SSE) --- */
        String headers =
            "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/event-stream\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.flush();

        boolean[] first = { true };

        boolean ok = generator.generate(prompt.toString(), maxTokens,
                (float) temp, (float) topP, topK,
                piece -> {
                    try {
                        JSONObject delta = new JSONObject();
                        delta.put("content", piece);

                        JSONObject choice = new JSONObject();
                        choice.put("index", 0);
                        choice.put("delta", delta);
                        choice.put("finish_reason", JSONObject.NULL);

                        JSONArray choices = new JSONArray();
                        choices.put(choice);

                        JSONObject chunk = new JSONObject();
                        chunk.put("id", id);
                        chunk.put("object", "chat.completion.chunk");
                        chunk.put("created", System.currentTimeMillis() / 1000L);
                        chunk.put("model", modelName);
                        chunk.put("choices", choices);

                        if (first[0]) {
                            JSONObject roleDelta = new JSONObject();
                            roleDelta.put("role", "assistant");
                            JSONObject roleChoice = new JSONObject();
                            roleChoice.put("index", 0);
                            roleChoice.put("delta", roleDelta);
                            roleChoice.put("finish_reason", JSONObject.NULL);
                            JSONArray roleChoices = new JSONArray();
                            roleChoices.put(roleChoice);
                            JSONObject roleChunk = new JSONObject();
                            roleChunk.put("id", id);
                            roleChunk.put("object", "chat.completion.chunk");
                            roleChunk.put("created", System.currentTimeMillis() / 1000L);
                            roleChunk.put("model", modelName);
                            roleChunk.put("choices", roleChoices);

                            writeSse(out, roleChunk.toString());
                            first[0] = false;
                        }

                        writeSse(out, chunk.toString());
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                });

        if (ok) {
            try {
                JSONObject choice = new JSONObject();
                choice.put("index", 0);
                choice.put("delta", new JSONObject());
                choice.put("finish_reason", "stop");
                JSONArray choices = new JSONArray();
                choices.put(choice);
                JSONObject chunk = new JSONObject();
                chunk.put("id", id);
                chunk.put("object", "chat.completion.chunk");
                chunk.put("created", System.currentTimeMillis() / 1000L);
                chunk.put("model", modelName);
                chunk.put("choices", choices);
                writeSse(out, chunk.toString());
            } catch (Exception ignored) {}
        }

        out.write("data: [DONE]\n\n".getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    /* ============================================================ */
    /* Helpers                                                      */
    /* ============================================================ */

    private static void writeSse(OutputStream out, String json) throws IOException {
        out.write("data: ".getBytes(StandardCharsets.UTF_8));
        out.write(json.getBytes(StandardCharsets.UTF_8));
        out.write("\n\n".getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static void sendJson(OutputStream out, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head =
            "HTTP/1.1 " + status + " " + statusText(status) + "\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: " + bytes.length + "\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Connection: close\r\n" +
            "\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    private static void sendError(OutputStream out, int status, String msg) throws IOException {
        JSONObject err = new JSONObject();
        try {
            JSONObject inner = new JSONObject();
            inner.put("message", msg);
            inner.put("type", "invalid_request_error");
            err.put("error", inner);
        } catch (Exception ignored) {}
        sendJson(out, status, err.toString());
    }

    private static String statusText(int s) {
        switch (s) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            default:  return "Status";
        }
    }
}
