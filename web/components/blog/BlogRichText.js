import EditorJSModule from "@editorjs/editorjs";
import HeaderModule from "@editorjs/header";
import ImageModule from "@editorjs/image";
import ListModule from "@editorjs/list";
import ParagraphModule from "@editorjs/paragraph";
import TableModule from "@editorjs/table";
import { useEffect, useId, useRef, useState } from "react";

import { blocksToEditorData, editorDataToBlocks } from "../../lib/blogDoc";

const EditorJS = EditorJSModule?.default || EditorJSModule;
const Header = HeaderModule?.default || HeaderModule;
const ImageTool = ImageModule?.default || ImageModule;
const List = ListModule?.default || ListModule;
const Paragraph = ParagraphModule?.default || ParagraphModule;
const Table = TableModule?.default || TableModule;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const I18N = {
  messages: {
    ui: {
      blockTunes: {
        toggler: {
          "Click to tune": "Настройки блока",
          "or drag to move": "или перетащите",
        },
      },
      inlineToolbar: {
        converter: {
          "Convert to": "Преобразовать",
        },
      },
      toolbar: {
        toolbox: {
          Add: "Добавить",
        },
      },
      popover: {
        Filter: "Поиск",
        "Nothing found": "Ничего не найдено",
        "Convert to": "Преобразовать",
      },
    },
    toolNames: {
      Text: "Текст",
      Heading: "Заголовок",
      List: "Список",
      "Unordered List": "Маркированный список",
      "Ordered List": "Нумерованный список",
      Checklist: "Чеклист",
      Table: "Таблица",
      Image: "Фото",
      Link: "Ссылка",
      Bold: "Жирный",
      Italic: "Курсив",
    },
    tools: {
      header: {
        "Heading 2": "Подзаголовок H2",
        "Heading 3": "Малый заголовок H3",
      },
      list: {
        Ordered: "Нумерованный",
        Unordered: "Маркированный",
      },
      table: {
        "With headings": "Со строкой заголовков",
        "Without headings": "Без заголовков",
        "Add column left": "Столбец слева",
        "Add column right": "Столбец справа",
        "Delete column": "Удалить столбец",
        "Add row above": "Строка выше",
        "Add row below": "Строка ниже",
        "Delete row": "Удалить строку",
      },
    },
    blockTunes: {
      delete: {
        Delete: "Удалить",
        "Click to delete": "Нажмите ещё раз",
      },
      moveUp: {
        "Move up": "Выше",
      },
      moveDown: {
        "Move down": "Ниже",
      },
    },
  },
};

export default function BlogRichText({ initialBlocks, token, onChange, onError }) {
  const holderId = useId().replace(/:/g, "");
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const tokenRef = useRef(token);
  const readyRef = useRef(false);
  const [bootState, setBootState] = useState("Готовим редактор…");
  onChangeRef.current = onChange;
  onErrorRef.current = onError;
  tokenRef.current = token;

  useEffect(() => {
    if (typeof EditorJS !== "function") {
      setBootState("Editor.js не загрузился");
      onErrorRef.current?.("Editor.js не загрузился");
      return undefined;
    }

    let cancelled = false;
    let editor = null;
    setBootState("Открываем редактор…");

    (async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled || !document.getElementById(holderId)) {
        if (!cancelled) setBootState("Контейнер редактора не найден");
        return;
      }

      try {
        editor = new EditorJS({
          holder: holderId,
          data: blocksToEditorData(initialBlocks),
          placeholder: "Начните писать или нажмите «+», чтобы добавить блок",
          autofocus: false,
          minHeight: 240,
          i18n: I18N,
          tools: {
            paragraph: {
              class: Paragraph,
              inlineToolbar: ["link", "bold", "italic"],
            },
            header: {
              class: Header,
              inlineToolbar: ["link", "bold", "italic"],
              config: {
                levels: [2, 3],
                defaultLevel: 2,
              },
            },
            list: {
              class: List,
              inlineToolbar: ["link", "bold", "italic"],
              config: {
                defaultStyle: "unordered",
              },
            },
            table: {
              class: Table,
              config: {
                rows: 3,
                cols: 2,
                withHeadings: true,
              },
            },
            image: {
              class: ImageTool,
              config: {
                captionPlaceholder: "Подпись",
                buttonContent: "Выберите фото",
                uploader: {
                  async uploadByFile(file) {
                    const form = new FormData();
                    form.append("file", file);
                    const res = await fetch(`${API_URL}/blog/uploads`, {
                      method: "POST",
                      headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {},
                      body: form,
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      const message = typeof data.detail === "string" ? data.detail : "Не удалось загрузить изображение.";
                      onErrorRef.current?.(message);
                      return { success: 0 };
                    }
                    return {
                      success: 1,
                      file: { url: `${API_URL}${data.url}` },
                    };
                  },
                  async uploadByUrl() {
                    onErrorRef.current?.("Загрузите файл с компьютера — внешние ссылки в тексте статьи не сохраняем.");
                    return { success: 0 };
                  },
                },
              },
            },
          },
          onChange: async () => {
            if (!readyRef.current || cancelled || !editor) return;
            try {
              const data = await editor.save();
              if (!cancelled) onChangeRef.current(editorDataToBlocks(data));
            } catch (err) {
              onErrorRef.current?.(err.message || "Не удалось прочитать текст редактора.");
            }
          },
        });

        await editor.isReady;
      } catch (err) {
        if (!cancelled) {
          setBootState(err.message || "Не удалось открыть редактор");
          onErrorRef.current?.(err.message || "Не удалось открыть редактор.");
        }
        return;
      }

      if (cancelled) {
        try {
          await editor.destroy();
        } catch {
          // already gone
        }
        return;
      }

      editorRef.current = editor;
      readyRef.current = true;
      setBootState("");
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      const current = editorRef.current || editor;
      editorRef.current = null;
      if (current?.isReady) {
        current.isReady
          .then(() => current.destroy())
          .catch(() => {});
      }
    };
    // initialBlocks берутся при монтировании; смена статьи — через key у родителя
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holderId]);

  return (
    <div className="blog-editorjs">
      {bootState ? <p className="muted blog-editorjs__boot">{bootState}</p> : null}
      <div id={holderId} className="blog-editorjs__holder" />
    </div>
  );
}
