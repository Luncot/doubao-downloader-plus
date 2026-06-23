import { memo, useCallback, useContext, useMemo } from "react";
import {
  Card,
  Image,
  Checkbox,
  Space,
  Button,
  Modal,
  Toast,
  Empty,
  Tag,
} from "@douyinfe/semi-ui-19";
import { useIsMobile } from "@/hooks/use-mobile";
import { ConvMessage } from "@/types";
import { ConvContext } from "@/context/ConvContext";
import { IconPlayCircle } from "@douyinfe/semi-icons";

interface ImageCardProps {
  className?: string;
  conv: ConvMessage;
  downloadedUrls?: Set<string>;
}

function ImageCard({ className, conv, downloadedUrls }: ImageCardProps) {
  const wh = useIsMobile() ? 120 : 133;
  const { handleDownload, handlePlay, handleSelect, selectKeys } = useContext(ConvContext);

  const isSelected = useMemo(
    () => conv.creation && selectKeys.includes(conv.creation?.image.key),
    [conv, selectKeys],
  );

  const isDownloaded = useMemo(
    () => conv.creation && downloadedUrls?.has(conv.creation.image.image_ori_raw.url),
    [conv, downloadedUrls],
  );

  const showPrompt = useCallback(() => {
    const gen_params = conv?.creation?.image.gen_params || "没有提示词";
    Modal.info({
      title: "提示词",
      content: gen_params,
      hasCancel: false,
      okText: "复制",
      onOk: () => {
        navigator.clipboard.writeText(gen_params);
        Toast.success("复制成功");
      },
    });
  }, [conv?.creation?.image.gen_params]);

  if (!conv.creation) {
    return (
      <div
        className={`${className} dd:relative dd:flex dd:items-center dd:justify-center`}
      >
        <Empty description="没有图像数据" />
      </div>
    );
  }

  return (
    <Card
      className={`${className} dd:relative dd:flex dd:items-center dd:justify-center`}
    >
      <Image
        width={wh}
        height={wh}
        src={conv.creation.image.image_ori_raw.url}
        style={{ marginTop: "10px" }}
      />
      {isDownloaded && (
        <Tag
          color="green"
          className="dd:absolute! dd:top-1 dd:left-1"
          size="small"
        >
          已下载
        </Tag>
      )}
      <Checkbox
        onChange={(e) =>
          conv.creation?.image.key &&
          handleSelect(conv.creation?.image.key, e.target.checked || false)
        }
        checked={isSelected}
        className="dd:absolute! dd:top-1 dd:right-1"
      />
      {conv.creation.creation_type === "video" && (
        <IconPlayCircle
          size="extra-large"
          className="dd:absolute! dd:top-3/8 dd:left-1/2 dd:-translate-x-1/2 dd:-translate-y-1/2 dd:cursor-pointer"
          onClick={() => handlePlay(conv)}
        />
      )}
      <Space className="dd:mt-2!">
        <Button type="tertiary" onClick={showPrompt}>
          提示词
        </Button>
        <Button onClick={() => handleDownload([conv])} type="tertiary">
          下载
        </Button>
      </Space>
    </Card>
  );
}

export default memo(ImageCard);
