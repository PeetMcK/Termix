import React, { useState } from "react";
import { toast } from "sonner";

interface ConfirmationOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

interface ToastButton {
  label: string;
  onClick: () => void;
  variant?: "default" | "destructive";
}

export function useConfirmation() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  const confirm = (opts: ConfirmationOptions, callback: () => void) => {
    setOptions(opts);
    setOnConfirm(() => callback);
    setIsOpen(true);
  };

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    setIsOpen(false);
    setOptions(null);
    setOnConfirm(null);
  };

  const handleCancel = () => {
    setIsOpen(false);
    setOptions(null);
    setOnConfirm(null);
  };

  // Flexible toast confirmation with 1-4 buttons
  function confirmWithToast(
    message: string,
    buttons: ToastButton[],
  ): void;
  // Legacy signature for backward compatibility
  function confirmWithToast(
    message: string,
    callback: () => void,
    variant?: "default" | "destructive",
  ): void;
  function confirmWithToast(
    message: string,
    buttonsOrCallback: ToastButton[] | (() => void),
    variant: "default" | "destructive" = "default",
  ): void {
    // Handle legacy 2-button signature
    if (typeof buttonsOrCallback === "function") {
      const actionText = variant === "destructive" ? "Delete" : "Confirm";
      toast(message, {
        action: {
          label: actionText,
          onClick: buttonsOrCallback,
        },
        cancel: {
          label: "Cancel",
          onClick: () => {},
        },
        duration: 10000,
        className: variant === "destructive" ? "border-red-500" : "",
      });
      return;
    }

    // Handle flexible button array
    const buttons = buttonsOrCallback;
    const hasDestructive = buttons.some((b) => b.variant === "destructive");

    const toastId = toast(message, {
      duration: Infinity,
      className: hasDestructive ? "border-red-500" : "",
      description: React.createElement(
        "div",
        { className: "flex gap-2 mt-3" },
        buttons.map((button, index) =>
          React.createElement(
            "button",
            {
              key: index,
              onClick: () => {
                toast.dismiss(toastId);
                button.onClick();
              },
              className: `flex-1 px-3 py-1.5 text-sm font-medium rounded ${
                button.variant === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`,
            },
            button.label
          )
        )
      ),
    });
  }

  return {
    isOpen,
    options,
    confirm,
    handleConfirm,
    handleCancel,
    confirmWithToast,
  };
}
