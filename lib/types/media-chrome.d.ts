import React from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'media-controller': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-control-bar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-play-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-seek-backward-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-seek-forward-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-time-range': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-time-display': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { showduration?: boolean }, HTMLElement>
      'media-mute-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-volume-range': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
      'media-fullscreen-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

export {} 