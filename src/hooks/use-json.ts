import { useEffect, useRef } from "react";
import type { ConvMessage } from "@/types";

interface UseJsonProps {
  showRaw?: boolean;
  callback: (messages: ConvMessage[]) => void;
}

function findAllKeysInJson(obj: object, key: string): any[] {
  const results: any[] = [];
  function search(current: any) {
    if (current && typeof current === "object") {
      if (
        !Array.isArray(current) &&
        Object.prototype.hasOwnProperty.call(current, key)
      ) {
        results.push(current[key]);
      }
      const items = Array.isArray(current) ? current : Object.values(current);
      for (const item of items) {
        search(item);
      }
    }
  }
  search(obj);
  return results;
}

function showRawImage(image: any) {
  if (!image) return;
  const rawImage = image.image_ori_raw?.url as string;
  if (rawImage && !rawImage.includes("watermark")) {
    if (image.image_ori) image.image_ori.url = rawImage;
    if (image.image_preview) image.image_preview.url = rawImage;
    if (image.image_thumb) image.image_thumb.url = rawImage;
  }
}

function extractCreations({
  creationsArray,
  baseInfo,
  showRaw,
}: {
  creationsArray: unknown[];
  baseInfo?: Partial<ConvMessage>;
  showRaw: boolean;
}): ConvMessage[] {
  const result: ConvMessage[] = [];

  creationsArray.forEach((creations: any) => {
    if (!Array.isArray(creations)) return;
    creations.forEach(async (creation: any) => {
      const isVideoCreation = creation.video && creation.video.vid && true;
      if (isVideoCreation) {
        result.push({
          ...baseInfo,
          creation: {
            creation_type: "video",
            vid: creation.video.vid,
            //image.image_ori_raw.url
            image: {
              key: creation.video.cover.key,
              image_ori_raw: {
                url: creation.video.cover.image_thumb.url,
              },
              gen_params: creation.video.gen_params?.prompt || "",
            },
          },
        } as ConvMessage);
      }
      const image = creation?.image;
      if (!image) return;

      // 原地替换 url
      showRaw && showRawImage(image);

      if (image?.image_ori_raw?.url && baseInfo) {
        result.push({
          ...baseInfo,
          creation: {
            creation_type: "image",
            image: {
              key: image.key,
              image_ori_raw: image.image_ori_raw,
              gen_params: image.gen_params?.prompt || "",
            },
          },
        } as ConvMessage);
      }
    });
  });

  return result;
}

function extractTtsContentText(tts_content: string) {
  try {
    const json = JSON.parse(tts_content);
    if (json.text) {
      return json.text;
    }
  } catch (error) {
    return tts_content;
  }
}

export function useJson({ showRaw = true, callback }: UseJsonProps) {
  const prevMessageIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const _parse = JSON.parse;
    window.origin_parse = JSON.parse;
    JSON.parse = function (text: string) {
      let jsonData = _parse(text);
      if (!text.includes("creations")) return jsonData;
      let messageList = findAllKeysInJson(jsonData, "messages");
      const newConv: ConvMessage[] = [];
      if (messageList.length === 0 && jsonData.message_id) {
        // 实时对话
        const message_id = jsonData.message_id;
        let creations = findAllKeysInJson(jsonData, "creations");
        if (creations.length > 0) {
          const extracted = extractCreations({
            creationsArray: creations,
            baseInfo: { message_id },
            showRaw,
          });
          newConv.push(...extracted);
        }
      } else {
        messageList.map((messages) =>
          messages.map((message: any) => {
            // 消息ID
            let creationList = findAllKeysInJson(message, "creations");
            const message_id = message.message_id;
            if (!prevMessageIds.current.has(message_id)) {
              prevMessageIds.current.add(message_id);

              const baseInfo: Partial<ConvMessage> = {
                index_in_conv: Number(message.index_in_conv),
                bot_reply_message_id: message.bot_reply_message_id,
                tts_content: extractTtsContentText(message.tts_content),
                conversation_id: message.conversation_id,
                message_id,
                create_time: message.create_time * 1000,
              };
              if (creationList.length > 0) {
                const extracted = extractCreations({
                  creationsArray: creationList,
                  baseInfo,
                  showRaw,
                });
                newConv.push(...extracted);
              } else {
                newConv.push(baseInfo as ConvMessage);
              }
            } else {
              // 显示原图
              extractCreations({
                creationsArray: creationList,
                showRaw,
              });
            }
          }),
        );
      }
      callback(newConv);
      return jsonData;
    };
    return () => {
      JSON.parse = window.origin_parse;
    };
  }, [showRaw]);
}
