#!/bin/bash
# Fallback build wrapper for pio-manager
ENV=$1
if [ -z "$ENV" ]; then
    pio run
else
    pio run -e $ENV
fi
