export interface DockPanelLayoutOptions {
  edgeGapPx: number;
  centerGapMinPx: number;
  centerGapMaxPx: number;
  centerGapRatio: number;
  compactMinWidthPx: number;
  primaryMinWidthPx: number;
  primaryMaxWidthPx: number;
  primaryWidthRatio: number;
  secondaryMinWidthPx: number;
  secondaryMaxWidthPx: number;
  secondaryWidthRatio: number;
}

export interface DockPanelLayoutInput {
  viewportWidth: number;
  primaryVisible: boolean;
  secondaryVisible: boolean;
  primaryWidthOverride: number | null;
  secondaryWidthOverride: number | null;
  options: DockPanelLayoutOptions;
  defaultViewportWidthPx?: number;
}

export interface DockPanelLayout {
  primaryWidth: number;
  primaryMaxWidth: number;
  secondaryWidth: number;
  secondaryMaxWidth: number;
}

export const DEFAULT_DOCK_PANEL_LAYOUT_OPTIONS: DockPanelLayoutOptions = {
  edgeGapPx: 12,
  centerGapMinPx: 220,
  centerGapMaxPx: 420,
  centerGapRatio: 0.28,
  compactMinWidthPx: 176,
  primaryMinWidthPx: 260,
  primaryMaxWidthPx: 520,
  primaryWidthRatio: 0.36,
  secondaryMinWidthPx: 240,
  secondaryMaxWidthPx: 420,
  secondaryWidthRatio: 0.3,
};

const DEFAULT_VIEWPORT_WIDTH_PX = 1280;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function responsivePanelWidth(
  viewportWidth: number,
  ratio: number,
  minWidth: number,
  maxWidth: number,
  edgeGapPx: number,
): number {
  const availableWidth = Math.max(1, viewportWidth - edgeGapPx * 2);
  return Math.round(clampNumber(
    viewportWidth * ratio,
    Math.min(minWidth, availableWidth),
    Math.min(maxWidth, availableWidth),
  ));
}

function panelPairMinimums(pairBudget: number, options: DockPanelLayoutOptions): {
  primaryMinimum: number;
  secondaryMinimum: number;
} {
  const compactMinimum = Math.min(options.compactMinWidthPx, Math.floor(pairBudget / 2));
  const primaryMinimum = Math.min(
    options.primaryMinWidthPx,
    Math.max(compactMinimum, pairBudget - options.secondaryMinWidthPx),
  );
  const secondaryMinimum = Math.min(
    options.secondaryMinWidthPx,
    Math.max(compactMinimum, pairBudget - primaryMinimum),
  );

  return { primaryMinimum, secondaryMinimum };
}

function fitPanelPair(
  primaryWidth: number,
  secondaryWidth: number,
  pairBudget: number,
  options: DockPanelLayoutOptions,
): {
  primaryWidth: number;
  secondaryWidth: number;
  primaryMinimum: number;
  secondaryMinimum: number;
} {
  const { primaryMinimum, secondaryMinimum } = panelPairMinimums(pairBudget, options);
  const totalWidth = primaryWidth + secondaryWidth;

  if (totalWidth <= pairBudget) {
    return { primaryWidth, secondaryWidth, primaryMinimum, secondaryMinimum };
  }

  const primaryShare = totalWidth > 0 ? primaryWidth / totalWidth : 0.55;
  const fittedPrimaryWidth = clampNumber(
    Math.round(pairBudget * primaryShare),
    primaryMinimum,
    Math.max(primaryMinimum, pairBudget - secondaryMinimum),
  );

  return {
    primaryWidth: fittedPrimaryWidth,
    secondaryWidth: Math.max(secondaryMinimum, pairBudget - fittedPrimaryWidth),
    primaryMinimum,
    secondaryMinimum,
  };
}

export function computeDockPanelLayout(input: DockPanelLayoutInput): DockPanelLayout {
  const {
    viewportWidth,
    primaryVisible,
    secondaryVisible,
    primaryWidthOverride,
    secondaryWidthOverride,
    options,
    defaultViewportWidthPx = DEFAULT_VIEWPORT_WIDTH_PX,
  } = input;

  const safeViewportWidth = Math.max(1, viewportWidth || defaultViewportWidthPx);
  const availableWidth = Math.max(1, safeViewportWidth - options.edgeGapPx * 2);

  const primaryAutoWidth = responsivePanelWidth(
    safeViewportWidth,
    options.primaryWidthRatio,
    options.primaryMinWidthPx,
    options.primaryMaxWidthPx,
    options.edgeGapPx,
  );

  const secondaryAutoWidth = responsivePanelWidth(
    safeViewportWidth,
    options.secondaryWidthRatio,
    options.secondaryMinWidthPx,
    options.secondaryMaxWidthPx,
    options.edgeGapPx,
  );

  if (!primaryVisible || !secondaryVisible) {
    const primaryWidth = Math.round(clampNumber(
      primaryWidthOverride ?? primaryAutoWidth,
      Math.min(options.primaryMinWidthPx, availableWidth),
      availableWidth,
    ));

    const secondaryWidth = Math.round(clampNumber(
      secondaryWidthOverride ?? secondaryAutoWidth,
      Math.min(options.secondaryMinWidthPx, availableWidth),
      availableWidth,
    ));

    return {
      primaryWidth,
      primaryMaxWidth: availableWidth,
      secondaryWidth,
      secondaryMaxWidth: availableWidth,
    };
  }

  const centerGap = clampNumber(
    Math.round(safeViewportWidth * options.centerGapRatio),
    options.centerGapMinPx,
    options.centerGapMaxPx,
  );

  const compactPairBudget = Math.min(availableWidth, options.compactMinWidthPx * 2);
  const pairBudget = Math.max(compactPairBudget, availableWidth - centerGap);

  const { primaryMinimum, secondaryMinimum } = panelPairMinimums(pairBudget, options);

  let primaryWidth = clampNumber(
    primaryWidthOverride ?? primaryAutoWidth,
    primaryMinimum,
    Math.max(primaryMinimum, pairBudget - secondaryMinimum),
  );

  let secondaryWidth = clampNumber(
    secondaryWidthOverride ?? secondaryAutoWidth,
    secondaryMinimum,
    Math.max(secondaryMinimum, pairBudget - primaryMinimum),
  );

  if (primaryWidth + secondaryWidth > pairBudget) {
    if (primaryWidthOverride !== null && secondaryWidthOverride === null) {
      secondaryWidth = Math.max(secondaryMinimum, pairBudget - primaryWidth);
    } else if (secondaryWidthOverride !== null && primaryWidthOverride === null) {
      primaryWidth = Math.max(primaryMinimum, pairBudget - secondaryWidth);
    } else {
      const fitted = fitPanelPair(primaryWidth, secondaryWidth, pairBudget, options);
      primaryWidth = fitted.primaryWidth;
      secondaryWidth = fitted.secondaryWidth;
    }
  }

  return {
    primaryWidth: Math.round(primaryWidth),
    primaryMaxWidth: Math.round(Math.max(primaryWidth, pairBudget - secondaryMinimum)),
    secondaryWidth: Math.round(secondaryWidth),
    secondaryMaxWidth: Math.round(Math.max(secondaryWidth, pairBudget - primaryMinimum)),
  };
}
