<script lang="ts">
    import { isEmpty } from "lodash";

    export let cursorName: string;
    export let tagName: string;
    export let backgroundColor: string;
    export let appliance: string;
    export let x: number;
    export let y: number;
    export let src: string;
    export let visible: boolean;
    export let avatar: string;
    export let theme: string;
    export let color: string;
    export let cursorTagBackgroundColor: string;
    export let opacity: number;

    $: hasName = !isEmpty(cursorName);
    $: hasTagName = !isEmpty(tagName);
    $: hasAvatar = !isEmpty(avatar);
    $: display = visible ? "initial" : "none";

    const computedAvatarStyle = () => {
        return Object.entries({
            width: (hasName ? 19 : 28) + "px",
            height: (hasName ? 19 : 28) + "px",
            position: hasName ? "initial" : "absolute",
            "border-color": hasName ? "white" : backgroundColor,
            "margin-right": (hasName ? 4 : 0) + "px",
        })
            .map(([key, v]) => `${key}: ${v}`)
            .join(";");
    };
</script>

<div
    class="netless-window-manager-cursor-mid"
    style="transform: translateX({x}px) translateY({y}px);display: {display}"
>
    <div class="netless-window-manager-cursor-name">
        <div
            class={theme}
            style="background-color: {backgroundColor};color: {color};opacity: {opacity}"
        >
            {#if hasAvatar}
                <img
                    class="netless-window-manager-cursor-selector-avatar"
                    style={computedAvatarStyle()}
                    src={avatar}
                    alt="avatar"
                />
            {/if}
            <span style="overflow: hidden;white-space: nowrap;text-overflow: ellipsis;max-width: 80px">{cursorName}</span>
            {#if hasTagName}
                <span class="netless-window-manager-cursor-tag-name" style="background-color: {cursorTagBackgroundColor}">
                    {tagName}
                </span>
            {/if}
        </div>
    </div>
    <div class="cursor-image-wrapper">
        <img class="netless-window-manager-cursor-{appliance}-image" {src} alt={appliance} />
    </div>
</div>
