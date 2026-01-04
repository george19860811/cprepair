import { GoogleGenAI } from "@google/genai";
import { RepairAnalysis } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
你是一位专业的“产品部维修专家”，拥有深厚的电子工程和维修经验。
你的核心任务是根据用户提供的故障描述（文字或图片），输出一份详尽、专业的维修方案。

**核心工作流（必须严格执行）**：
1. **优先检索自建知识库**：
   - 检查用户提供的“自建维修知识库”上下文。
   - 如果发现设备型号、故障现象与知识库中的条目匹配或高度相似，**必须**优先采用该条目中的“问题分析”和“存档方案”。
   - 在报告开头明确指出：“📚 匹配到知识库历史案例：[设备名]”。
   - 将知识库中的分析作为基础，并结合你自身作为 AI 的知识库进行补充（例如补充具体的电路图查找建议、最新的技术通报等）。

2. **多模态综合分析**：
   - 如果用户上传了图片，请仔细扫描 PCB 上的烧损、鼓包、虚焊或腐蚀迹象。
   - 结合图片视觉信息和文字描述进行诊断。

3. **联网搜索（Grounding）**：
   - 使用 'googleSearch' 工具检索该型号设备的官方维修手册、原理图（Schematic）或论坛中同类故障的讨论。

**输出结构（Markdown）**：
*   **📚 知识库匹配情况**：(若有匹配，请详述匹配理由及知识库中的原始建议)
*   **⚠️ 安全与环境警告**：(针对具体设备的危险电压或静电防护提醒)
*   **👀 视觉诊断报告**：(基于图片的分析，如无图片可跳过)
*   **🔍 核心故障分析**：(结合知识库方案与 AI 逻辑推理出的根本原因)
*   **🛠️ 建议维修清单**：(所需备件、测试仪器及具体规格)
*   **📋 维修实操步骤**：(详细、循序渐进的操作指南)
*   **💡 专家经验心得**：(维修该类故障的避坑指南)

语言：简体中文。语气：严谨、专业、高效。
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
      const errorMessage = error.message || error.error?.message || JSON.stringify(error);
      const errorCode = error.status || error.error?.code;

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
        delay *= 2; 
        continue;
      }
      throw error;
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

    let textPrompt = `【当前故障上报】\n描述：${description}\n\n`;
    
    if (knowledgeBase) {
        textPrompt += `【待查阅：自建维修知识库上下文】\n请务必先核对以下数据，重点参考其中的“问题分析”字段内容：\n\n${knowledgeBase}\n\n`;
    }

    textPrompt += `请作为产品部维修专家，结合上述信息输出最终维修方案。`;

    parts.push({
      text: textPrompt,
    });

    const response = await generateWithRetry(
      "gemini-3-pro-preview", 
      {
        contents: {
          parts: parts,
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
        },
      },
      4,
      2000
    );

    const text = response.text || "无法生成分析结果，请稍后重试。";
    
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
    if (msg.includes("500") || msg.includes("XHR") || msg.includes("Rpc") || msg.includes("UNKNOWN")) {
        throw new Error("诊断引擎连接波动，请重试。系统将自动尝试重新连接知识库。");
    }
    throw new Error("诊断过程中发生错误，请检查输入或稍后重试。");
  }
};