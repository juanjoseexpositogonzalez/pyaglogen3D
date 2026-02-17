function vecindario = determinarVecindad( clusters )

    numClusters = size( clusters, 1 );

    if iscell( clusters )
        clusters = cell2mat( clusters );
    end

    if ( size( clusters, 2 ) > 4 )
        clusters = clusters( :, 3 : end );
    end

    % Variables de salida para guardar la vecindad y la suma de los radios de los monómeros 
    vecindario = zeros( numClusters  );
    distancias = zeros( numClusters  );

    % Calculamos las distancias entre los centros geométricos de los monómeros
    for m = 1 : numClusters
        intermedio = clusters( 1 : end, 1 : 3 ) - repmat( clusters( m, 1 : 3 ), numClusters , 1 );
        vecindario( m, : ) = arrayfun( @( x ) norm( intermedio( x, : ) ), 1 : size( intermedio, 1 ) );
        distancias( m, : ) = repmat( clusters( m, 4 ), numClusters , 1 ) + clusters( 1 : end, 4 );
    end

    vecindario = sparse( vecindario  );
    distancias = sparse( distancias  );

    % La condición para ser vecinas es la siguiente (nos quedamos con los elementos que están por encima de la
    % primera diagonal--la siguiente a la superior)
    vecindario = vecindario - distancias <= 0;

    vecindario = full( vecindario );
    % Ahora quitamos el autonúmero de coordinación
    for m = 1 : numClusters
        for n = m : m
            vecindario( m, n ) = 0;
        end
    end

    vecindario = sparse( vecindario );
end