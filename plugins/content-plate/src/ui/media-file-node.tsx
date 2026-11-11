"use client";

import { useMediaState } from "@platejs/media/react";
import { ResizableProvider } from "@platejs/resizable";
import { BlockMenuPlugin } from "@platejs/selection/react";
import { FileUpIcon } from "lucide-react";
import {
  PlateElement,
  type PlateElementProps,
  useEditorRef,
  useReadOnly,
  withHOC,
} from "platejs/react";
import type { MouseEvent } from "react";
import { useFixedToolbar } from "../hooks/use-host-slots";

import { BlockActionButton } from "./block-context-menu";
import { Caption, CaptionTextarea } from "./caption";
import { MediaToolbar } from "./media-toolbar";

export const MediaFileElement = withHOC(
  ResizableProvider,
  function MediaFileElement(props: PlateElementProps) {
    const readOnly = useReadOnly();
    const editor = useEditorRef();
    const fixedToolbar = useFixedToolbar();
    const { name } = useMediaState();

    const onOpenMenu = (e: MouseEvent) => {
      editor.getApi(BlockMenuPlugin).blockMenu.showContextMenu(props.element.id as string, {
        x: e.clientX,
        y: e.clientY,
      });
    };

    return (
      <PlateElement className="my-px rounded-sm" {...props}>
        <div
          className="group group/media relative m-0 flex cursor-pointer items-center rounded px-0.5 py-[3px] transition-bg-ease hover:bg-muted"
          contentEditable={false}
          onClick={onOpenMenu}
          role="button"
        >
          <div className="flex items-center gap-1 p-1">
            <FileUpIcon className="size-5" />
            <div>{name}</div>
          </div>

          <Caption align="left">
            <CaptionTextarea
              className="text-left"
              placeholder="Write a caption..."
              readOnly={readOnly}
            />
          </Caption>

          {fixedToolbar && <BlockActionButton className="-translate-y-1/2 top-1/2" />}
          <div onClick={(event) => event.stopPropagation()}><MediaToolbar /></div>
        </div>

        {props.children}
      </PlateElement>
    );
  },
);
