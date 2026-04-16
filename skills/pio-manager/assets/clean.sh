#!/bin/bash
# Fallback clean wrapper for pio-manager
ENV=$1
if [ -z "$ENV" ]; then
    pio run -t clean
else
    pio run -e $ENV -t clean
fi
