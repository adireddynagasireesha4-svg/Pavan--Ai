import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type Persona = "General" | "Doctor" | "Learner" | "Study" | "Suggest" | "Logic" | "Scientist" | "Studio" | "Coder";

export interface Message {
  role: "user" | "model";
  content: string;
  type: "text" | "image";
  imageUrl?: string;
  groundingMetadata?: any;
}

export interface ImageParams {
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "1:4" | "1:8" | "4:1" | "8:1";
  imageSize?: "512px" | "1K" | "2K" | "4K";
  style?: string;
  referenceImage?: string; // base64
}

export async function generateChatResponse(
  prompt: string,
  history: Message[],
  shortcutMode: boolean = false,
  imageParams?: ImageParams,
  persona: Persona = "General",
  uploadedImage?: string,
  location?: { latitude: number, longitude: number }
): Promise<Message> {
  const executeWithRetry = async (fn: () => Promise<any>, retries = 2, delay = 2000) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const errorStr = JSON.stringify(error);
        const isQuotaError = errorStr.includes("429") || 
                            errorStr.includes("RESOURCE_EXHAUSTED");
        
        if (isQuotaError && i < retries) {
          console.warn(`Quota exceeded, retrying in ${delay * (i + 1)}ms... (Attempt ${i + 1}/${retries})`);
          await new Promise(r => setTimeout(r, delay * (i + 1)));
          continue;
        }
        throw error;
      }
    }
  };

  const isImageRequest = prompt.toLowerCase().includes("generate image") || 
                         prompt.toLowerCase().includes("create image") ||
                         prompt.toLowerCase().includes("draw") ||
                         prompt.toLowerCase().includes("show me a picture of");

  const isLocationRequest = prompt.toLowerCase().includes("nearby") || 
                            prompt.toLowerCase().includes("where is") || 
                            prompt.toLowerCase().includes("restaurant") || 
                            prompt.toLowerCase().includes("location") ||
                            prompt.toLowerCase().includes("map") ||
                            prompt.toLowerCase().includes("directions");

  if (isImageRequest) {
    const parts: any[] = [{ text: `${prompt}${imageParams?.style ? `. Style: ${imageParams.style}` : ""}` }];
    
    if (imageParams?.referenceImage) {
      parts.unshift({
        inlineData: {
          mimeType: "image/png",
          data: imageParams.referenceImage.split(",")[1] || imageParams.referenceImage,
        },
      });
      parts[1].text = `Using the provided reference image for character consistency (same face), ${parts[1].text}`;
    }

    try {
      const response = await executeWithRetry(() => ai.models.generateContent({
        model: "gemini-1.5-pro",
        contents: [{ parts }],
        config: {
          imageConfig: {
            aspectRatio: imageParams?.aspectRatio || "1:1",
            imageSize: imageParams?.imageSize || "1K",
          },
        },
      }));

      let imageUrl = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      return {
        role: "model",
        content: response.text || "Here is the realistic image you requested with character consistency.",
        type: "image",
        imageUrl,
      };
    } catch (error: any) {
      console.error("Image generation failed after retries:", error);
      throw error;
    }
  }

  // Image Editing or Multimodal Analysis
  const isEditRequest = uploadedImage && (
    prompt.toLowerCase().includes("edit") || 
    prompt.toLowerCase().includes("change") || 
    prompt.toLowerCase().includes("modify") || 
    prompt.toLowerCase().includes("add") || 
    prompt.toLowerCase().includes("remove") || 
    prompt.toLowerCase().includes("background") ||
    prompt.toLowerCase().includes("photoshop") ||
    prompt.toLowerCase().includes("filter") ||
    prompt.toLowerCase().includes("transform") ||
    prompt.toLowerCase().includes("inpaint") ||
    prompt.toLowerCase().includes("outpaint") ||
    prompt.toLowerCase().includes("extend") ||
    prompt.toLowerCase().includes("expand") ||
    prompt.toLowerCase().includes("fill")
  );

  if (isEditRequest && uploadedImage) {
    try {
      const response = await executeWithRetry(() => ai.models.generateContent({
        model: "gemini-1.5-pro",
        contents: {
          parts: [
            {
              inlineData: {
                data: uploadedImage.split(",")[1] || uploadedImage,
                mimeType: "image/png",
              },
            },
            { text: prompt },
          ],
        },
      }));

      let editedImageUrl = "";
      let textContent = "";

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          editedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
        } else if (part.text) {
          textContent += part.text;
        }
      }

      if (editedImageUrl) {
        return {
          role: "model",
          content: textContent || "I've edited the image as requested.",
          type: "image",
          imageUrl: editedImageUrl,
        };
      }
    } catch (error: any) {
      console.error("Image editing failed after retries:", error);
      throw error;
    }
  }

  // Text generation with search grounding
  let modelName = shortcutMode ? "gemini-1.5-flash" : "gemini-1.5-pro";
  
  // Use 1.5-flash for maps grounding
  if (isLocationRequest) {
    modelName = "gemini-1.5-flash";
  }

  const getSystemInstruction = () => {
    const base = `You are the fastest AI answer provider. 
    You provide answers about:
    - Generative AI
    - Medical AI
    - Scientific AI
    - Research AI
    - Coding AI
    - Image Generation AI
    
    TASK:
    Provide a complete, accurate, structured, and strictly secure answer.
    
    REQUIREMENTS:
    - ALWAYS ensure answers prioritize security, user privacy, and ethical guidelines. Do not generate unsafe, insecure, or harmful data.
    - Use step-by-step explanation
    - Include diagrams (ASCII if needed)
    - Provide formulas where applicable
    - Include real-world examples
    - Give advantages & disadvantages
    - Optimize for exam scoring (10/10 answer)
    
    DATA:
    Use knowledge from:
    - Academic sources (MIT, NPTEL, research papers)
    - Real-world datasets
    - Industry best practices
    
    OUTPUT STYLE:
    - Clear headings
    - Bullet points
    - Concise but detailed
    - No unnecessary text with fastest ai answer provider`;

    const personaInstructions: Record<Persona, string> = {
      General: "Provide balanced, accurate, and helpful information on any topic.",
      Doctor: "Act as an AI Doctor. Provide medical information, health tips, and symptom analysis. ALWAYS include a disclaimer that you are an AI and not a replacement for professional medical advice.",
      Learner: "Act as an AI Learner. Help users learn new concepts by breaking them down into simple, digestible parts. Use analogies and examples.",
      Study: "Act as an AI Study Material Generator. Create summaries, flashcards, practice questions, and structured notes for any subject.",
      Suggest: "Act as an AI Suggestion Engine. Provide personalized recommendations for books, movies, tools, or actions based on user context.",
      Logic: "Act as an AI Logic Specialist. Provide highly structured, step-by-step logical reasoning. Use first-principles thinking and formal logic where applicable.",
      Scientist: "Act as an AI Scientist. Provide deep scientific analysis, research-backed information, and technical explanations. Use the scientific method and cite potential research areas.",
      Studio: "Act as an AI Image Editor and Creative Studio. Your goal is to help users edit, transform, and create stunning visual content. When an image is uploaded, you can perform edits like background removal, adding objects, applying artistic filters, inpainting (filling in missing areas), and outpainting (extending image boundaries). You are the 'Photoshop' of AI assistants.",
      Coder: "Act as an AI Coding Specialist. You have deep knowledge of all programming languages, their official IDEs, runtimes, and package managers (e.g., pip, npm, cargo, gem). Provide code snippets, installation commands, and best practices for any language."
    };

    const mode = shortcutMode 
      ? "CRITICAL: You are in 'ULTRA-FAST SHORTCUT MODE'. Provide the 'Perfect Shortcut': extremely concise, 1-2 sentence answers that get straight to the point. No fluff, no introductions, just the intelligence. Use bullet points for data." 
      : "Provide detailed, comprehensive, and easy-to-understand explanations with deep reasoning.";

    return `${base}\n\nCURRENT ROLE: ${personaInstructions[persona]}\n\nRESPONSE MODE: ${mode}\n\nAlways prioritize accuracy and use Google Search/Maps grounding for real-time verification. If asked for an image, use the provided reference face if available to ensure character consistency.`;
  };

  const contents: any[] = [
    ...history.map(m => ({
      role: m.role,
      parts: m.imageUrl ? [
        { inlineData: { mimeType: "image/png", data: m.imageUrl.split(",")[1] || m.imageUrl } },
        { text: m.content || "Analyze this image." }
      ] : [{ text: m.content }]
    })),
    { 
      role: "user", 
      parts: uploadedImage ? [
        { inlineData: { mimeType: "image/png", data: uploadedImage.split(",")[1] || uploadedImage } },
        { text: prompt || "Analyze this image." }
      ] : [{ text: prompt }]
    }
  ];

  try {
    const response = await executeWithRetry(async () => {
      try {
        const tools: any[] = [{ googleSearch: {} }, { urlContext: {} }];
        let toolConfig: any = undefined;

        if (isLocationRequest) {
          tools.push({ googleMaps: {} });
          if (location) {
            toolConfig = {
              retrievalConfig: {
                latLng: {
                  latitude: location.latitude,
                  longitude: location.longitude
                }
              }
            };
          }
        }

        return await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction: getSystemInstruction(),
            tools,
            toolConfig,
          },
        });
      } catch (error: any) {
        // Fallback to flash if pro fails with quota
        if (!shortcutMode && (JSON.stringify(error).includes("429") || JSON.stringify(error).includes("RESOURCE_EXHAUSTED"))) {
          console.warn("Pro model quota exceeded, falling back to Flash model...");
          return await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents,
            config: {
              systemInstruction: getSystemInstruction(),
              tools: [{ googleSearch: {} }, { urlContext: {} }],
            },
          });
        }
        throw error;
      }
    });

    const result: Message = {
      role: "model",
      content: response.text || "I'm sorry, I couldn't generate a response.",
      type: "text",
    };

    if (response.candidates?.[0]?.groundingMetadata) {
      result.groundingMetadata = response.candidates[0].groundingMetadata;
    }

    return result;
  } catch (error: any) {
    console.error("Chat generation failed after retries:", error);
    throw error;
  }
}
