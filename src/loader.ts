// import { getItem, setItem } from "./storage";
// import { NetlessApp } from "./typings";

// const TIMEOUT = 10000; // 10 秒超时

// export const getScript = async (url: string, key: string) => {
//     const item = await getItem(key);
//     if (item) {
//         return item;
//     } else {
//         const result = await fetchWithTimeout(url, { timeout: TIMEOUT });
//         const text = await result.text();
//         await setItem(key, text);
//         return text;
//     }
// }

// export const executeScript = (text: string, name: string): NetlessApp => {
//     let result = Function(text)();
//     if (typeof result === "undefined") {
//         // @ts-ignore
//         result = window[name];  
//     }
//     return result;
// }

// export const loadApp = async (name: string, url: string) => {
//     const text = await getScript(url, name);
//     try {
//         return executeScript(text, name);
//     } catch (error) {
//         if (error.message.includes("Can only have one anonymous define call per script file")) {
//             // @ts-ignore
//             const define = window.define;
//             if("function" == typeof define && define.amd) {
//                 delete define.amd;
//             }
//             return executeScript(text, name);
//         }
//     }
// }


// async function fetchWithTimeout(resource: string, options: RequestInit & { timeout: number }) {
//     const { timeout = 10000 } = options;

//     const controller = new AbortController();
//     const id = setTimeout(() => controller.abort(), timeout);

//     const response = await fetch(resource, {
//       ...options,
//       signal: controller.signal
//     });
//     clearTimeout(id);

//     return response;
//   }