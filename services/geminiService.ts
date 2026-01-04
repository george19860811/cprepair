import { GoogleGenAI } from "@google/genai";
import { RepairAnalysis } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
You are an expert Electronics Repair Technician and Engineer (产品部维修专家).
Your goal is to help users repair electronic devices.

You have access to a **User-Provided Knowledge Base** (Self-built Problem Library).
**CRITICAL PROCESS**:
1.  **Check Knowledge Base FIRST**: Scan the provided Knowledge Base for devices or failure descriptions similar to the user's current issue.
    *   If a match is found, your primary strategy MUST be based on the "Existing Analysis/Solution" from the library.
    *   Cite the matched entry explicitly.
    *   Then, VALIDATE if that old solution applies to the current description/image and EXPAND upon it with web search (datasheets, new forums).
    *   If the library solution is brief, flesh it out into full steps.
2.  **Analyze Visuals (if provided)**: Look for physical defects.
3.  **Analyze Text**: Identify failure modes.
4.  **Search**: Use 'googleSearch' tool for specific manuals/datasheets.
5.  **Plan**: Create a structured repair plan.

Output Structure (Markdown):
*   **📚 知识库匹配 (Knowledge Base Match)**: (Only if a relevant entry is found) "Found similar case in your library: [Device Name]. Archive solution suggests: [Summary]..."
*   **⚠️ 安全警告 (Safety Warning)**
*   **👀 视觉分析 (Visual Analysis)**: (If image provided)
*   **🔍 故障诊断 (Diagnosis)**: Explain the theory.
*   **🛠️ 所需工具 (Tools Needed)**
*   **📋 维修步骤 (Step-by-Step Plan)**
*   **💡 专家提示 (Pro Tips)**

Tone: Professional, Technical, Encouraging.
Language: Chinese (Simplified).
`;

// Helper function to retry API calls on transient network errors
async function generateWithRetry(modelName: string, params: any, retries = 3, initialDelay = 2000) {
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        ...params
      });
    } catch (error: any) {
      // Extract error details safely
      const errorMessage = error.message || error.error?.message || JSON.stringify(error);
      const errorCode = error.status || error.error?.code;

      // Check for network/transport errors (RPC, XHR, 500, Fetch, Unknown)
      const isNetworkError = (
        errorMessage.includes("Rpc failed") ||
        errorMessage.includes("xhr error") ||
        errorMessage.includes("500") ||
        errorMessage.includes("fetch") ||
        errorMessage.includes("network") ||
        errorMessage.includes("Failed to fetch") ||
        errorCode === 500 ||
        errorCode === "UNKNOWN"
      );

      if (isNetworkError && i < retries - 1) {
        console.warn(`Gemini API attempt ${i + 1} failed (Network/RPC Error). Retrying in ${delay}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        continue;
      }
      throw error; // Throw if not a network error or max retries reached
    }
  }
  throw new Error("Max retries reached");
}

export const analyzeRepairIssue = async (
  description: string,
  images?: { data: string; mimeType: string }[],
  knowledgeBase?: string
): Promise<RepairAnalysis> => {
  try {
    const parts: any[] = [];

    // Add Images if present
    if (images && images.length > 0) {
        images.forEach(img => {
            parts.push({
                inlineData: {
                    data: img.data,
                    mimeType: img.mimeType
                }
            });
        });
    }

    // Construct the prompt combining description and KB
    let textPrompt = `用户当前设备/问题描述: ${description}\n\n`;
    
    if (knowledgeBase) {
        textPrompt += `*** 📚 自建维修知识库 (User's Private Knowledge Base) ***\n请优先参考以下历史案例进行分析。如果找到相似案例，请在报告开头明确引用。\n\n${knowledgeBase}\n\n*** 知识库结束 ***\n\n`;
    }

    textPrompt += `请结合图片（如果有）、上述知识库内容以及你的专业知识进行全面分析。`;

    // Add Text Description
    parts.push({
      text: textPrompt,
    });

    const response = await generateWithRetry(
      "gemini-2.5-flash", 
      {
        contents: {
          parts: parts,
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }], // Enable Google Search Grounding
        },
      },
      4, // Increase retry count
      2000 // Increase initial delay to 2s
    );

    const text = response.text || "无法生成分析结果，请稍后重试。";
    
    // Extract grounding sources and map to local strict type
    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingChunks = rawChunks.map(chunk => {
      if (chunk.web && chunk.web.uri && chunk.web.title) {
        return {
          web: {
            uri: chunk.web.uri,
            title: chunk.web.title
          }
        };
      }
      return {};
    });

    return {
      diagnosis: "Analysis Complete",
      rawText: text,
      sources: groundingChunks,
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    
    const msg = error.message || error.error?.message || JSON.stringify(error);

    // Provide a more user-friendly error message for connection issues
    if (msg.includes("500") || msg.includes("XHR") || msg.includes("Rpc") || msg.includes("UNKNOWN")) {
        throw new Error("服务器连接不稳定 (Network Error)。AI 正在思考，但网络连接中断，请重试。");
    }
    // Handle 404 specifically for better UX
    if (msg.includes("404") || msg.includes("NOT_FOUND")) {
         throw new Error("模型服务未找到 (404)。请联系管理员检查模型配置。");
    }
    
    throw new Error("分析过程中发生错误，请稍后重试。");
  }
};