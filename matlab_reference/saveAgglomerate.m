function [ h, e ] = saveAgglomerate( part, eS, numExec, Dir, name )

% saveAgglomerate( part, eS, numExec )
% Plots and saves the agglomerate as per part matrix
%
% Input Data:
% part:     Matrix with particles centre coordinates and radius
% eS:       Evolving sphere coordinates
% numExec:  Number of execution for the agglomerate
% Dir:      DirectoformatSpec = '%03.0f';ry where pictures will reside
% name:     Custom name of picture to save (if not provided a default one will be used)
%
% Output Data:
% h:        Vector of handles for each particle drawn
% e:        Vector of handles for the evolving Sphere

%% Plotting
close all;
[ h, e ] = plotAgglomerate( part, eS );

%% Save agglomerate
az = 0;
el = 0;
view( az, el );

if nargin == 4
name = [ sprintf( formatSpec, numExec ), 'Aglo', ...
    sprintf( formatSpec, size( part, 1 ) ) '.tif' ];
else
    name = [ name '.tif' ];
end
[ ~ ,dirAct, ~ ] = fileparts( pwd );

if ( ~strcmp( dirAct, Dir ) )
    if exist( fullfile( pwd, Dir ), 'dir' )
        saveas( gcf(), fullfile( pwd, Dir, name ) );
        close all;
    else
        mkdir( fullfile( pwd, Dir ) );
        saveas( gcf(), fullfile( pwd, Dir, name ) );
        close all;
    end
else
    saveas( gcf(), fullfile( pwd, Dir, name ) );
    close all;
end