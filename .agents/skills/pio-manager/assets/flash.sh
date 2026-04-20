#!/bin/bash
# Fallback flash wrapper for pio-manager
ENV=$1
if [ -z "$ENV" ]; then
    pio run -t upload
else
    pio run -e $ENV -t upload
fi
