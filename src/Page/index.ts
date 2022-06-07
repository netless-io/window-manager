import type { PageState } from "./PageController";

export * from "./PageController";

export const calculateNextIndex = (index: number, pageState: PageState) => {
    let nextIndex = 0;
    if (index === 0) {
        return index + 1;
    }
    if (pageState.index !== 0 && index !== 0) {
        const maxIndex = pageState.length - 1;
        if (index === maxIndex) {
            nextIndex = maxIndex - 1;   
        } else if (index > 0 && index < maxIndex) {
            nextIndex = index + 1;
        }
    }
    return nextIndex;
}
