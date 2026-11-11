"use client";

import { useMediaState } from "@platejs/media/react";
import { ResizableProvider } from "@platejs/resizable";
import { PlateElement, type PlateElementProps, withHOC } from "platejs/react";

import { Caption, CaptionTextarea } from "./caption";
import { MediaToolbar } from "./media-toolbar";

export const MediaAudioElement = withHOC(
  ResizableProvider,
  function MediaAudioElement(props: PlateElementProps) {
    const { align = "center", readOnly, unsafeUrl } = useMediaState();

    return (
      <PlateElement className="mb-1" {...props}>
        <figure className="group group/media relative" contentEditable={false}>
          <div className="h-16">
            <audio className="size-full" controls src={unsafeUrl} />
          </div>
          <MediaToolbar />

          <Caption align={align} style={{ width: "100%" }}>
            <CaptionTextarea
              className="h-20"
              placeholder="Write a caption..."
              readOnly={readOnly}
            />
          </Caption>
        </figure>
        {props.children}
      </PlateElement>
    );
  },
);
