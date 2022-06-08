import type { PageState } from "./PageController";

export * from "./PageController";

export const calculateNextIndex = (index: number, pageState: PageState) => {
    let nextIndex = 0;
    const maxIndex = pageState.length - 1;
    if (index === pageState.index) {
        if (index === maxIndex) {
            nextIndex = index - 1;
        } else {
            nextIndex = pageState.index + 1;
        }
    } else {
        nextIndex = pageState.index;
    }
    return nextIndex;
}
