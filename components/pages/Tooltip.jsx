/* eslint-disable react/prop-types */

const InfoCircledIcon = (props) => <svg viewBox='0 0 15 15' width='15' height='15' fill='currentColor' {...props}><path fillRule='evenodd' clipRule='evenodd' d='M7.5 1a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM.5 7.5a7 7 0 1114 0 7 7 0 01-14 0zM8.25 4.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM6 6.5h1.25v4H6v-4z'/></svg>
import * as RTooltip from '@radix-ui/react-tooltip'
export default function Tooltip({ title, children, className }) {
    return (
        <RTooltip.Provider>
            <RTooltip.Root>
                <RTooltip.Trigger asChild>
                    <button className='items-center flex flex-row'>
                        {title}
                        <InfoCircledIcon className={className ? className : 'h-4 w-4 text-mtmain ml-1'} />
                    </button>
                </RTooltip.Trigger>
                <RTooltip.Portal>
                    <RTooltip.Content
                        className='select-none rounded bg-white px-[15px] py-2.5 text-[15px] leading-none text-violet11 shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] will-change-[transform,opacity] data-[state=delayed-open]:data-[side=bottom]:animate-slideUpAndFade data-[state=delayed-open]:data-[side=left]:animate-slideRightAndFade data-[state=delayed-open]:data-[side=right]:animate-slideLeftAndFade data-[state=delayed-open]:data-[side=top]:animate-slideDownAndFade z-50'
                        sideOffset={5}
                    >
                        {children}
                    </RTooltip.Content>
                </RTooltip.Portal>
            </RTooltip.Root>
        </RTooltip.Provider>
    )
}
export  function Tooltip2({ description, children }) {
    return (
        <RTooltip.Provider delayDuration={200}>
            <RTooltip.Root>
                <RTooltip.Trigger asChild>
                    {children}
                </RTooltip.Trigger>
                <RTooltip.Portal>
                   
                    <RTooltip.Content
                        className='select-none rounded bg-black px-[15px] py-2.5 text-[15px] leading-none shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] will-change-[transform,opacity] data-[state=delayed-open]:data-[side=bottom]:animate-slideUpAndFade data-[state=delayed-open]:data-[side=left]:animate-slideRightAndFade data-[state=delayed-open]:data-[side=right]:animate-slideLeftAndFade data-[state=delayed-open]:data-[side=top]:animate-slideDownAndFade z-50 text-white text-xs'
                        sideOffset={5}
                    >
                         <RTooltip.TooltipArrow className='fill-black' />
                        {description}
                    </RTooltip.Content>
                </RTooltip.Portal>
            </RTooltip.Root>
        </RTooltip.Provider>
    )
}
